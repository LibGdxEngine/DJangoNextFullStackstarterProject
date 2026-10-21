"""Action permissions and workspace-scoped record visibility."""
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied
from apps.organizations.models import OrganizationMember
from . import models as m

CAPABILITIES = {
    "admin": {"manage_people", "manage_schedule", "report_lesson", "approve_session", "view_finance", "manage_finance", "manage_settings", "manage_roles", "view_internal", "import", "reports"},
    "coordinator": {"manage_people", "manage_schedule", "report_lesson", "approve_session", "view_internal", "import", "reports"},
    "accountant": {"view_finance", "manage_finance", "reports"},
    "teacher": {"report_lesson", "view_internal", "own_earnings"},
    "family": {"request_change", "submit_payment"},
}


class Access:
    def __init__(self, user, organization, workspace=None):
        self.user = user
        self.organization = organization
        if not user.is_authenticated or not user.is_active or user.status != "active" or not organization.is_active:
            raise PermissionDenied("An active account and academy are required.")
        roles = set(m.StaffRole.objects.filter(organization=organization, user=user, is_active=True).values_list("role", flat=True))
        if OrganizationMember.objects.filter(organization=organization, user=user, role__in=["OWNER", "ADMIN"]).exists():
            roles.add("admin")
        self.teacher_ids = list(m.Teacher.objects.filter(organization=organization, user=user, is_active=True).values_list("id", flat=True))
        self.family_ids = list(m.Family.objects.filter(organization=organization, is_active=True).filter(Q(contacts__user=user) | Q(students__user=user, students__is_adult=True)).distinct().values_list("id", flat=True))
        if self.teacher_ids:
            roles.add("teacher")
        if self.family_ids:
            roles.add("family")
        self.workspaces = []
        if roles & {"admin", "coordinator", "accountant"}:
            self.workspaces.append("management")
        if "teacher" in roles:
            self.workspaces.append("teacher")
        if "family" in roles:
            self.workspaces.append("family")
        self.workspace = workspace or (self.workspaces[0] if self.workspaces else None)
        if self.workspace not in self.workspaces:
            raise PermissionDenied("You do not have access to this academy workspace.")
        self.roles = roles & {"admin", "coordinator", "accountant"} if self.workspace == "management" else {self.workspace}
        self.capabilities = set().union(*(CAPABILITIES[role] for role in self.roles))

    def require(self, capability):
        if capability not in self.capabilities:
            raise PermissionDenied("This action is not allowed in your workspace.")

    def students(self):
        qs = m.Student.objects.filter(organization=self.organization)
        if self.workspace == "teacher":
            return qs.filter(Q(teacher_id__in=self.teacher_ids) | Q(sessions__teacher_id__in=self.teacher_ids)).distinct()
        if self.workspace == "family":
            # A self contact grants the adult access to their own student record,
            # whereas parents/guardians may access the family's linked children.
            guardian_families = m.FamilyContact.objects.filter(organization=self.organization, user=self.user, relationship__in=["parent", "guardian"]).values("family_id")
            return qs.filter(Q(family_id__in=guardian_families) | Q(user=self.user, is_adult=True)).distinct()
        return qs

    def sessions(self):
        qs = m.Session.objects.filter(organization=self.organization)
        if self.workspace == "teacher":
            return qs.filter(teacher_id__in=self.teacher_ids)
        if self.workspace == "family":
            return qs.filter(student__in=self.students())
        return qs
