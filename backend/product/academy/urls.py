from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from .auth import PhoneLoginRequestView, PhoneLoginConfirmView
from .workspaces import WorkspaceListView

app_name = "academy"
router = DefaultRouter()
for prefix, view in [
    ("settings", views.AcademySettingsViewSet),
    ("members", views.AcademyMemberViewSet),
    ("staff-roles", views.StaffRoleViewSet),
    ("families", views.FamilyViewSet),
    ("family-contacts", views.FamilyContactViewSet),
    ("students", views.StudentViewSet),
    ("student-notes", views.StudentNoteViewSet),
    ("teachers", views.TeacherViewSet),
    ("teacher-rates", views.TeacherRateViewSet),
    ("availability", views.AvailabilityViewSet),
    ("packages", views.PackageViewSet),
    ("enrollments", views.EnrollmentViewSet),
    ("balance-entries", views.BalanceEntryViewSet),
    ("schedules", views.RecurringScheduleViewSet),
    ("sessions", views.SessionViewSet),
    ("lesson-records", views.LessonRecordViewSet),
    ("progress", views.QuranProgressViewSet),
    ("lesson-preferences", views.LessonPreferenceViewSet),
    ("payments", views.PaymentViewSet),
    ("payroll", views.PayrollViewSet),
    ("earnings", views.EarningEntryViewSet),
    ("earnings-issues", views.EarningsIssueViewSet),
    ("session-requests", views.SessionRequestViewSet),
    ("message-templates", views.MessageTemplateViewSet),
    ("message-automations", views.MessageAutomationViewSet),
    ("messages", views.MessageViewSet),
    ("imports", views.ImportJobViewSet),
    ("history", views.HistoryEventViewSet),
    ("dashboard", views.WorkspaceDashboardViewSet),
]:
    router.register(prefix, view, basename=prefix)

urlpatterns = [
    path("auth/request-code/", PhoneLoginRequestView.as_view(), name="request-code"),
    path("auth/confirm-code/", PhoneLoginConfirmView.as_view(), name="confirm-code"),
    path("workspaces/", WorkspaceListView.as_view(), name="workspaces"),
    path("<uuid:organization_id>/", include(router.urls)),
]
