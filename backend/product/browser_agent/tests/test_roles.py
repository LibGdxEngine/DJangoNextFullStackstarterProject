from unittest.mock import patch

from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.organizations.models import Organization, OrganizationMember
from product.browser_agent.models import AgentRole, AgentRun, TaskTemplate
from product.browser_agent.services import role_prompt
from product.browser_agent.tests.test_api import make_user


class RoleTestCase(APITestCase):
    def setUp(self):
        self.user = make_user("owner@example.com")
        self.other = make_user("other@example.com")
        self.org = Organization.objects.create(name="Acme", slug="acme")
        self.other_org = Organization.objects.create(name="Other", slug="other")
        OrganizationMember.objects.create(organization=self.org, user=self.user)
        OrganizationMember.objects.create(organization=self.other_org, user=self.other)
        self.client.force_authenticate(self.user)
        self.builtin = AgentRole.objects.get(slug="salma", organization=None)


class AgentRoleApiTests(RoleTestCase):
    list_url = reverse("browser_agent:role-list")

    def test_lists_builtin_and_own_roles_only(self):
        mine = AgentRole.objects.create(organization=self.org, slug="mine", name="Mine", title="t")
        AgentRole.objects.create(organization=self.other_org, slug="theirs", name="Theirs", title="t")
        res = self.client.get(self.list_url)
        self.assertEqual(res.status_code, 200)
        slugs = [r["slug"] for r in res.data]
        self.assertEqual(slugs[:4], ["salma", "omar", "youssef", "hisham"])
        self.assertIn(mine.slug, slugs)
        self.assertNotIn("theirs", slugs)

    def test_counts_active_runs_in_my_organizations(self):
        AgentRun.objects.create(organization=self.org, role=self.builtin, task="a", status=AgentRun.Status.RUNNING)
        AgentRun.objects.create(organization=self.org, role=self.builtin, task="b", status=AgentRun.Status.SUCCEEDED)
        AgentRun.objects.create(organization=self.other_org, role=self.builtin, task="c",
                                status=AgentRun.Status.RUNNING)
        res = self.client.get(self.list_url, {"organization": str(self.org.id)})
        salma = next(r for r in res.data if r["slug"] == "salma")
        self.assertEqual(salma["active_runs"], 1)
        self.assertTrue(salma["is_builtin"])

    def test_hire_custom_role(self):
        res = self.client.post(self.list_url, {
            "organization": str(self.org.id), "name": "منى", "title": "مصممة",
            "instructions": "Design social posts."}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        role = AgentRole.objects.get(pk=res.data["id"])
        self.assertEqual(role.organization, self.org)
        self.assertTrue(role.slug.startswith("custom-"))
        self.assertFalse(res.data["is_builtin"])

    def test_cannot_hire_in_foreign_organization(self):
        res = self.client.post(self.list_url, {
            "organization": str(self.other_org.id), "name": "x", "title": "y"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_builtin_roles_are_read_only(self):
        url = reverse("browser_agent:role-detail", args=[self.builtin.id])
        self.assertEqual(self.client.patch(url, {"name": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(url).status_code, 403)

    def test_edit_and_remove_custom_role(self):
        role = AgentRole.objects.create(organization=self.org, slug="mine", name="Mine", title="t")
        url = reverse("browser_agent:role-detail", args=[role.id])
        res = self.client.patch(url, {"title": "new"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        moved = self.client.patch(url, {"organization": str(self.other_org.id)}, format="json")
        self.assertEqual(moved.status_code, 400)
        self.assertEqual(self.client.delete(url).status_code, 204)

    def test_foreign_custom_role_is_hidden(self):
        theirs = AgentRole.objects.create(organization=self.other_org, slug="t", name="T", title="t")
        res = self.client.get(reverse("browser_agent:role-detail", args=[theirs.id]))
        self.assertEqual(res.status_code, 404)


class RunRoleTests(RoleTestCase):
    list_url = reverse("browser_agent:run-list")

    @patch("product.browser_agent.views.run_agent.delay_on_commit")
    def test_create_run_with_role(self, enqueue):
        res = self.client.post(self.list_url, {
            "organization": str(self.org.id), "task": "x", "role": str(self.builtin.id)}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["role_detail"]["name"], "سلمى")
        self.assertEqual(AgentRun.objects.get().role, self.builtin)

    @patch("product.browser_agent.views.run_agent.delay_on_commit")
    def test_rejects_role_from_other_organization(self, enqueue):
        theirs = AgentRole.objects.create(organization=self.other_org, slug="t", name="T", title="t")
        res = self.client.post(self.list_url, {
            "organization": str(self.org.id), "task": "x", "role": str(theirs.id)}, format="json")
        self.assertEqual(res.status_code, 400)
        enqueue.assert_not_called()

    def test_role_prompt(self):
        self.assertEqual(role_prompt(None), "")
        prompt = role_prompt(self.builtin)
        self.assertIn("سلمى", prompt)
        self.assertIn(self.builtin.instructions, prompt)


class TaskTemplateApiTests(RoleTestCase):
    list_url = reverse("browser_agent:task-template-list")

    def test_lists_seeded_templates_with_category_labels(self):
        res = self.client.get(self.list_url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), TaskTemplate.objects.filter(organization=None).count())
        first = res.data[0]
        self.assertEqual(first["category"], "leads")
        self.assertEqual(first["category_label"], "عملاء ومبيعات")
        self.assertEqual(first["role"], self.builtin.id)

    def test_filters_by_category_and_search(self):
        support = self.client.get(self.list_url, {"category": "sup"}).data
        self.assertEqual({t["category"] for t in support}, {"sup"})
        found = self.client.get(self.list_url, {"search": "المخزون"}).data
        self.assertEqual([t["title"] for t in found], ["مراقبة المخزون"])

    def test_hides_other_organizations_templates(self):
        TaskTemplate.objects.create(organization=self.other_org, category="sup", title="secret", prompt="p")
        mine = TaskTemplate.objects.create(organization=self.org, category="sup", title="ours", prompt="p")
        titles = {t["title"] for t in self.client.get(self.list_url).data}
        self.assertIn(mine.title, titles)
        self.assertNotIn("secret", titles)


class RolePromptTests(SimpleTestCase):
    def test_role_without_instructions(self):
        role = AgentRole(name="Mona", title="Designer")
        self.assertEqual(role_prompt(role), "\n\nYour role: you are Mona, Designer.")
