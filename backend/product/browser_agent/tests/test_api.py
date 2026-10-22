import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import UserStatus
from apps.organizations.models import Organization, OrganizationMember
from product.browser_agent.models import AgentArtifact, AgentRun, BrowserProfile
from product.browser_agent.tasks import reap_stale_runs

User = get_user_model()


def make_user(email):
    return User.objects.create_user(
        email=email, phone=f"+2010{abs(hash(email)) % 10**8:08d}", password="Passw0rd!123",
        status=UserStatus.ACTIVE)


class AgentRunApiTests(APITestCase):
    def setUp(self):
        self.user = make_user("owner@example.com")
        self.other = make_user("other@example.com")
        self.org = Organization.objects.create(name="Acme", slug="acme")
        self.other_org = Organization.objects.create(name="Other", slug="other")
        OrganizationMember.objects.create(organization=self.org, user=self.user)
        OrganizationMember.objects.create(organization=self.other_org, user=self.other)
        self.client.force_authenticate(self.user)
        self.list_url = reverse("browser_agent:run-list")

    @patch("product.browser_agent.views.run_agent.delay_on_commit")
    def test_create_queues_run(self, enqueue):
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(self.list_url, {"organization": str(self.org.id), "task": "Open example.com"},
                                   format="json")
        self.assertEqual(res.status_code, 201, res.data)
        run = AgentRun.objects.get()
        self.assertEqual(run.status, AgentRun.Status.QUEUED)
        self.assertEqual(run.created_by, self.user)
        enqueue.assert_called_once_with(str(run.id))

    @patch("product.browser_agent.views.run_agent.delay_on_commit")
    def test_cannot_create_in_foreign_organization(self, enqueue):
        res = self.client.post(self.list_url, {"organization": str(self.other_org.id), "task": "x"}, format="json")
        self.assertEqual(res.status_code, 403)
        enqueue.assert_not_called()

    @patch("product.browser_agent.views.run_agent.delay_on_commit")
    def test_rejects_profile_from_other_organization(self, enqueue):
        profile = BrowserProfile.objects.create(organization=self.other_org, name="p")
        res = self.client.post(self.list_url, {
            "organization": str(self.org.id), "task": "x", "profile": str(profile.id)}, format="json")
        self.assertEqual(res.status_code, 400)
        enqueue.assert_not_called()

    @override_settings(AGENT_MAX_ACTIVE_RUNS_PER_ORG=1)
    @patch("product.browser_agent.views.run_agent.delay_on_commit")
    def test_active_run_cap(self, enqueue):
        AgentRun.objects.create(organization=self.org, task="busy", status=AgentRun.Status.RUNNING)
        res = self.client.post(self.list_url, {"organization": str(self.org.id), "task": "x"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_runs_are_scoped_to_membership(self):
        mine = AgentRun.objects.create(organization=self.org, task="mine")
        theirs = AgentRun.objects.create(organization=self.other_org, task="theirs")
        res = self.client.get(self.list_url)
        ids = {r["id"] for r in (res.data["results"] if isinstance(res.data, dict) else res.data)}
        self.assertEqual(ids, {str(mine.id)})
        self.assertEqual(self.client.get(reverse("browser_agent:run-detail", args=[theirs.id])).status_code, 404)

    def test_cancel_flags_active_run_only(self):
        run = AgentRun.objects.create(organization=self.org, task="t", status=AgentRun.Status.RUNNING)
        done = AgentRun.objects.create(organization=self.org, task="t", status=AgentRun.Status.SUCCEEDED)
        res = self.client.post(reverse("browser_agent:run-cancel", args=[run.id]))
        self.assertEqual(res.status_code, 202)
        run.refresh_from_db()
        self.assertTrue(run.cancel_requested)
        self.assertEqual(self.client.post(reverse("browser_agent:run-cancel", args=[done.id])).status_code, 400)

    def test_events_after_cursor(self):
        run = AgentRun.objects.create(organization=self.org, task="t")
        for seq in range(3):
            run.events.create(seq=seq, kind="message", payload={"text": str(seq)})
        res = self.client.get(reverse("browser_agent:run-events", args=[run.id]), {"after": 2})
        self.assertEqual([e["seq"] for e in res.data], [2])

    def test_download_serves_artifact_and_blocks_traversal(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(AGENT_RUNS_ROOT=Path(tmp)):
            run = AgentRun.objects.create(organization=self.org, task="t")
            (Path(tmp) / str(run.id) / "workspace").mkdir(parents=True)
            (Path(tmp) / str(run.id) / "workspace" / "a.txt").write_text("hi")
            (Path(tmp) / "secret.txt").write_text("secret")
            good = AgentArtifact.objects.create(run=run, kind="file", path="workspace/a.txt", size=2)
            bad = AgentArtifact.objects.create(run=run, kind="file", path="../secret.txt", size=6)
            ok = self.client.get(reverse("browser_agent:run-download", args=[run.id, good.id]))
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(b"".join(ok.streaming_content), b"hi")
            blocked = self.client.get(reverse("browser_agent:run-download", args=[run.id, bad.id]))
            self.assertEqual(blocked.status_code, 404)


    def test_artifacts_of_a_running_run_are_picked_up_from_disk(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(AGENT_RUNS_ROOT=Path(tmp)):
            run = AgentRun.objects.create(organization=self.org, task="t", status=AgentRun.Status.RUNNING)
            report = Path(tmp) / str(run.id) / "workspace" / "report.csv"
            report.parent.mkdir(parents=True)
            report.write_text("a,b\n")
            url = reverse("browser_agent:run-artifacts", args=[run.id])

            listed = self.client.get(url).data
            self.assertEqual([(a["path"], a["size"]) for a in listed], [("workspace/report.csv", 4)])

            report.write_text("a,b\n1,2\n")  # the agent keeps writing
            self.assertEqual(self.client.get(url).data[0]["size"], 8)

            run.status = AgentRun.Status.SUCCEEDED
            run.save()
            (report.parent / "late.txt").write_text("x")
            # Finished runs list what was recorded at the end, without rescanning.
            self.assertEqual(len(self.client.get(url).data), 1)


class ReapStaleRunsTests(APITestCase):
    def test_fails_stale_runs_and_frees_profile(self):
        org = Organization.objects.create(name="Acme", slug="acme")
        profile = BrowserProfile.objects.create(organization=org, name="p", in_use=True)
        stale = AgentRun.objects.create(
            organization=org, task="t", status=AgentRun.Status.RUNNING, profile=profile,
            started_at=timezone.now() - timedelta(days=1))
        fresh = AgentRun.objects.create(
            organization=org, task="t", status=AgentRun.Status.RUNNING, started_at=timezone.now())
        self.assertEqual(reap_stale_runs(), 1)
        stale.refresh_from_db()
        fresh.refresh_from_db()
        profile.refresh_from_db()
        self.assertEqual(stale.status, AgentRun.Status.FAILED)
        self.assertEqual(fresh.status, AgentRun.Status.RUNNING)
        self.assertFalse(profile.in_use)
