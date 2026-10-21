from django.db import migrations

ROLES = [
    {
        'slug': 'salma', 'name': 'سلمى', 'title': 'تطوير العملاء', 'avatar': '/agents/sales.png', 'tint': '#EEE8FF',
        'summary': 'تبحث في LinkedIn وخرائط جوجل والمجموعات، وتعود إليك بعملاء جاهزين للتواصل.',
        'skills': ['استقطاب', 'تأهيل', 'تواصل أول'],
        'instructions': (
            'You work as a business development representative. Find prospects that fit the request on '
            'LinkedIn, Google Maps and public directories, verify each one, and return them as a table '
            '(name, company, contact details, source link). Never invent contact details.'),
    },
    {
        'slug': 'omar', 'name': 'عمر', 'title': 'التسويق والإعلانات', 'avatar': '/agents/marketer.png',
        'tint': '#FFEBDD',
        'summary': 'يدير صفحاتك وحملاتك على Meta وجوجل، ويختبر الإعلانات ويوقف غير المجدي منها.',
        'skills': ['حملات', 'سوشيال', 'محتوى وتصميم'],
        'instructions': (
            'You work as a marketing specialist. Plan and run campaigns and social content, compare ad '
            'performance with numbers from the ad platforms, and explain every budget change you make.'),
    },
    {
        'slug': 'youssef', 'name': 'يوسف', 'title': 'خدمة العملاء', 'avatar': '/agents/support.png',
        'tint': '#FFE6EE',
        'summary': 'يرد على واتساب وإنستجرام خلال ثوانٍ، بأسلوب علامتك التجارية.',
        'skills': ['واتساب', 'متابعة', 'شكاوى'],
        'instructions': (
            'You work as a customer support agent. Answer customers politely in the language they wrote '
            'in, follow up on open questions, and escalate complaints to the user with a short summary '
            'instead of promising refunds or exceptions yourself.'),
    },
    {
        'slug': 'hisham', 'name': 'هشام', 'title': 'المالية والتقارير', 'avatar': '/agents/finance.png',
        'tint': '#E4ECFF',
        'summary': 'يعمل على أنظمتك ويراقب الأرقام، ويرسل إليك التقرير الصباحي والتنبيهات المهمة.',
        'skills': ['تقارير', 'مراقبة', 'عروض تقديمية'],
        'instructions': (
            'You work as a finance and reporting analyst. Pull figures from the user\'s systems, compare '
            'them with earlier periods, flag anything unusual, and present results as concise tables. '
            'Never change records in accounting systems unless the user explicitly asked.'),
    },
]

# (category, role slug, image, title, description, prompt)
TEMPLATES = [
    ('leads', 'salma', '/agents/sales.png', '٥٠ عميلًا محتملًا',
     '٥٠ نشاطًا تجاريًا في مدينتك برقم الهاتف والموقع وحساب إنستجرام، في جدول.',
     'اجمع ٥٠ نشاطًا تجاريًا في مدينتي برقم الهاتف والموقع وحساب إنستجرام، وضعها في جدول.'),
    ('video', 'omar', '/agents/marketer.png', 'فيديو ريلز من فكرة',
     'سيناريو، ولقطات، وصوت، وموسيقى، وترجمة — فيديو جاهز للنشر.',
     'حوّل فكرتي إلى فيديو ريلز: اكتب السيناريو، واقترح اللقطات والموسيقى، وجهّز الترجمة.'),
    ('study', 'hisham', '/agents/finance.png', 'بحث موثّق',
     'يجمع المصادر الموثوقة، ويكتب البحث، وينسّق المراجع.',
     'اكتب لي بحثًا موثّقًا عن الموضوع التالي، من مصادر موثوقة ومع قائمة مراجع منسّقة: '),
    ('mk', 'omar', '/agents/marketer.png', 'أطلق حملة واختبر ٣ تصاميم',
     'يطلق الحملة، ويقارن التصاميم أسبوعيًا، ويوقف غير المجدي منها.',
     'أطلق حملة إعلانية بثلاثة تصاميم مختلفة، وقارن نتائجها، وأوقف التصميم الأضعف.'),
    ('mk', 'omar', '/agents/marketer.png', 'خطة محتوى الشهر',
     '٣٠ منشورًا بالنصوص والوسوم، مصمّمة ومجدولة على صفحتك.',
     'اكتب خطة محتوى لشهر كامل: ٣٠ منشورًا بالنصوص والوسوم ومواعيد النشر.'),
    ('sup', 'youssef', '/agents/support.png', 'الرد على رسائل العملاء',
     'يفرز الرسائل، ويرد على المتكرر، ويحيل إليك المهم فقط.',
     'رُد على رسائل العملاء المتكررة، وأحِل إليّ الشكاوى والطلبات المهمة فقط مع ملخص لكل منها.'),
    ('sup', 'youssef', '/agents/support.png', 'متابعة العملاء المتوقفين',
     'رسالة متابعة لكل عميل سأل عن السعر ولم يرد منذ أسبوع.',
     'أرسل رسالة متابعة لكل عميل سأل عن السعر ولم يرد منذ أسبوع.'),
    ('pres', 'hisham', '/agents/finance.png', 'عرض لمحاضرة أو مؤتمر',
     'حدّد الموضوع، ويعود إليك بـ ١٥ شريحة مصمّمة مع المراجع.',
     'أعدّ عرضًا تقديميًا من ١٥ شريحة مع المراجع عن الموضوع التالي: '),
    ('fin', 'hisham', '/agents/finance.png', 'مراقبة المخزون',
     'يتابع المخزون كل ساعة وينبّهك قبل نفاد أي صنف.',
     'راجع المخزون في نظامي، ونبّهني بالأصناف التي توشك على النفاد.'),
]


def seed(apps, schema_editor):
    AgentRole = apps.get_model('browser_agent', 'AgentRole')
    TaskTemplate = apps.get_model('browser_agent', 'TaskTemplate')
    roles = {}
    for order, fields in enumerate(ROLES):
        fields = dict(fields)
        slug = fields.pop('slug')
        roles[slug], _ = AgentRole.objects.update_or_create(
            organization=None, slug=slug, defaults={**fields, 'sort_order': order})
    for order, (category, role, image, title, description, prompt) in enumerate(TEMPLATES):
        TaskTemplate.objects.update_or_create(
            organization=None, title=title,
            defaults={'category': category, 'role': roles[role], 'image': image,
                      'description': description, 'prompt': prompt, 'sort_order': order})


def unseed(apps, schema_editor):
    apps.get_model('browser_agent', 'TaskTemplate').objects.filter(organization=None).delete()
    apps.get_model('browser_agent', 'AgentRole').objects.filter(organization=None).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('browser_agent', '0002_roles_and_templates'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
