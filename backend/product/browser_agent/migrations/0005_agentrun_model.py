from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('browser_agent', '0004_resume_and_questions'),
    ]

    operations = [
        migrations.AddField(
            model_name='agentrun',
            name='model',
            field=models.CharField(blank=True, db_default='', default='', help_text='The model the worker ran the task with, set when the run is claimed.', max_length=200),
        ),
    ]
