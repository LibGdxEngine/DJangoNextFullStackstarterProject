"""Bounded CSV/XLSX family/student import; no macros, formulas or remote files."""
import csv
import io
import posixpath
import zipfile
from xml.etree import ElementTree as ET
from django.core.exceptions import ValidationError as ModelValidationError
from rest_framework.exceptions import ValidationError
from .. import models as m
from ..validators import validate_timezone
from apps.accounts.phone import normalize_phone
from .common import history

FIELDS = {"family_external_id", "family_name", "contact_name", "phone", "student_external_id", "student_name", "timezone", "language", "is_adult"}
REQUIRED = {"family_external_id", "family_name", "contact_name", "phone", "student_external_id", "student_name"}
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_upload(upload):
    if upload.size > 5 * 1024 * 1024:
        raise ValidationError({"file": "Maximum import size is 5 MB."})
    content = upload.read()
    try:
        if upload.name.lower().endswith(".csv"):
            table = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
        elif upload.name.lower().endswith(".xlsx"):
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if len(archive.infolist()) > 200 or sum(info.file_size for info in archive.infolist()) > 20 * 1024 * 1024:
                    raise ValueError("Workbook is too large after decompression.")
                strings = []
                if "xl/sharedStrings.xml" in archive.namelist():
                    shared = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                    strings = ["".join(el.itertext()) for el in shared.findall("s:si", NS)]
                workbook = ET.fromstring(archive.read("xl/workbook.xml"))
                sheet = workbook.find("s:sheets/s:sheet", NS)
                if sheet is None:
                    raise ValueError("No worksheet found.")
                rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
                rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
                rel = next(r for r in rels if r.attrib.get("Id") == rel_id)
                if rel.attrib.get("TargetMode") == "External":
                    raise ValueError("External worksheets are not supported.")
                target = rel.attrib["Target"]
                target = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
                if not target.startswith("xl/worksheets/"):
                    raise ValueError("Invalid worksheet location.")
                sheet = ET.fromstring(archive.read(target))
                table = []
                for row in sheet.findall("s:sheetData/s:row", NS):
                    values = []
                    for cell in row.findall("s:c", NS):
                        if cell.find("s:f", NS) is not None:
                            raise ValueError("Replace spreadsheet formulas with values before import.")
                        letters = "".join(ch for ch in cell.attrib.get("r", "A1") if ch.isalpha())
                        index = 0
                        for letter in letters.upper():
                            index = index * 26 + ord(letter) - 64
                        if index > 50 or index < 1:
                            raise ValueError("At most 50 columns are supported.")
                        while len(values) < index:
                            values.append("")
                        value = cell.find("s:v", NS)
                        text = value.text or "" if value is not None else ""
                        if cell.attrib.get("t") == "s":
                            text = strings[int(text)]
                        elif cell.attrib.get("t") == "inlineStr":
                            text = "".join(cell.find("s:is", NS).itertext())
                        values[index - 1] = text
                    table.append(values)
        else:
            raise ValueError("Upload a UTF-8 CSV or XLSX file.")
    except (UnicodeError, ValueError, KeyError, IndexError, StopIteration, zipfile.BadZipFile, ET.ParseError) as exc:
        raise ValidationError({"file": str(exc)})
    if not table or not table[0] or len(table) > 5001 or any(len(row) > 50 for row in table):
        raise ValidationError({"file": "Provide a header and at most 5,000 rows / 50 columns."})
    columns = [str(v).strip() for v in table[0]]
    if len(set(columns)) != len(columns) or any(not v for v in columns):
        raise ValidationError({"file": "Column names must be unique and nonempty."})
    rows = [{key: str(row[i]).strip() if i < len(row) else "" for i, key in enumerate(columns)} for row in table[1:] if any(row)]
    return columns, rows


def validate_import(job, mapping):
    if set(mapping) - FIELDS or not REQUIRED <= set(mapping) or any(source not in job.columns for source in mapping.values()) or len(set(mapping.values())) != len(mapping):
        raise ValidationError({"mapping": "Map each required destination field to a unique source column."})
    errors, cleaned, seen, families = [], [], set(), {}
    for index, source in enumerate(job.rows, start=2):
        row = {dest: source.get(column, "") for dest, column in mapping.items()}
        try:
            if any(not row.get(key) for key in REQUIRED):
                raise ValueError("Required values are missing.")
            if any(len(row[key]) > 100 for key in ["family_external_id", "student_external_id"]) or any(len(row[key]) > 200 for key in ["family_name", "student_name", "contact_name"]):
                raise ValueError("External IDs must be at most 100 characters; names at most 200.")
            row["phone"] = normalize_phone(row["phone"])
            row["timezone"] = row.get("timezone") or "Africa/Cairo"
            validate_timezone(row["timezone"])
            row["language"] = row.get("language") or "ar"
            if row["language"] not in {"ar", "en"}:
                raise ValueError("Language must be ar or en.")
            adult = str(row.get("is_adult", "false")).lower()
            if adult not in {"true", "false", "1", "0", ""}:
                raise ValueError("is_adult must be true or false.")
            row["is_adult"] = adult in {"true", "1"}
            if row["student_external_id"] in seen:
                raise ValueError("Duplicate student external ID in this file.")
            seen.add(row["student_external_id"])
            if m.Student.objects.filter(organization=job.organization, external_id=row["student_external_id"]).exists():
                raise ValueError("Student external ID already exists; this importer only adds new students.")
            fingerprint = (row["family_name"], row["phone"], row["timezone"], row["language"])
            previous = families.setdefault(row["family_external_id"], fingerprint)
            if previous != fingerprint:
                raise ValueError("Rows for the same family have inconsistent contact details.")
            existing = m.Family.objects.filter(organization=job.organization, external_id=row["family_external_id"]).first()
            if existing and (not existing.is_active or existing.name != row["family_name"] or not existing.contacts.filter(phone=row["phone"]).exists()):
                raise ValueError("Existing family details do not match; review the family before linking.")
            cleaned.append(row)
        except (ValueError, ModelValidationError) as exc:
            errors.append({"row": index, "message": str(exc)})
    return cleaned, errors


def execute_import(job, actor):
    if job.status != "validated":
        raise ValidationError("Validate the mapping before importing.")
    rows, errors = validate_import(job, job.mapping)
    if errors:
        raise ValidationError({"rows": [f"Row {item['row']}: {item['message']}" for item in errors]})
    family_count, student_ids = 0, []
    for row in rows:
        family, created = m.Family.objects.get_or_create(organization=job.organization, external_id=row["family_external_id"], defaults={"name": row["family_name"], "timezone": row["timezone"], "language": row["language"]})
        if created:
            family_count += 1
            m.FamilyContact.objects.create(organization=job.organization, family=family, name=row["contact_name"], phone=row["phone"], relationship="self" if row["is_adult"] else "parent")
        student = m.Student.objects.create(organization=job.organization, family=family, name=row["student_name"], external_id=row["student_external_id"], timezone=row["timezone"], language=row["language"], is_adult=row["is_adult"])
        student_ids.append(str(student.id))
        history(student, actor, "imported", import_job=job.id)
    job.status = "imported"
    job.result = {"families_created": family_count, "students_created": len(student_ids), "student_ids": student_ids}
    job.save()
    history(job, actor, "imported", result=job.result)
    return job


def safe_csv(rows):
    stream = io.StringIO()
    writer = csv.writer(stream)
    for row in rows:
        writer.writerow(["'" + str(v) if str(v).startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else v for v in row])
    return stream.getvalue()
