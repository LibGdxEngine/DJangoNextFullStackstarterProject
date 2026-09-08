from django.urls import path
from .views import hello_world, system_status

app_name = 'common'

urlpatterns = [
    path('hello/', hello_world, name='hello_world'),
    path('status/', system_status, name='system_status'),
]
