from django.urls import path

from .views import KeyDetailView, KeyView, OCRJobDetailView, OCRJobResultView, OCRJobView

app_name = "ocr"
urlpatterns = [
    path("keys/", KeyView.as_view(), name="keys"),
    path("keys/<uuid:key_id>/", KeyDetailView.as_view(), name="key-detail"),
    path("jobs/", OCRJobView.as_view(), name="jobs"),
    path("jobs/<uuid:job_id>/", OCRJobDetailView.as_view(), name="job-detail"),
    path("jobs/<uuid:job_id>/result/", OCRJobResultView.as_view(), name="job-result"),
]
