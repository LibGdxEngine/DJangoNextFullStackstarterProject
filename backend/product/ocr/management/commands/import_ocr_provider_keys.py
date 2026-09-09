"""Import a provider credential CSV without exposing its contents in output."""

import csv
from contextlib import nullcontext
import hashlib
import json
import re
import sys
from datetime import datetime, timezone

from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction

from product.ocr.api_key_service import lock_key_pool
from product.ocr.credential_crypto import encrypt_api_key, fingerprint_api_key
from product.ocr.models import OCRProviderKey


COLUMNS = ["id", "email", "status", "api_key", "api_key_status", "leased_by",
           "lease_expires_at", "created_at", "updated_at", "exhausted_at"]
TIMESTAMPS = ["lease_expires_at", "created_at", "updated_at", "exhausted_at"]


def parse_row(row, line):
    if set(row) != set(COLUMNS) or any(value is None for value in row.values()):
        raise CommandError(f"Incorrect column count at CSV line {line}.")
    if not re.fullmatch(r"[1-9][0-9]*", row["id"]) or int(row["id"]) > 2**63 - 1:
        raise CommandError(f"Invalid ID at CSV line {line}.")
    values = {"id": int(row["id"])}
    for field, maximum in [("email", 254), ("status", 32), ("api_key_status", 32), ("leased_by", 255)]:
        if len(row[field]) > maximum or "\x00" in row[field]:
            raise CommandError(f"Invalid {field} at CSV line {line}.")
        values[field] = row[field]
    if len(row["api_key"]) > 8192 or "\x00" in row["api_key"]:
        raise CommandError(f"Invalid credential field at CSV line {line}.")
    for field in TIMESTAMPS:
        text = row[field].strip()
        try:
            stamp = datetime.fromisoformat(text) if text else None
            if stamp is not None:
                stamp = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)
        except (ValueError, OverflowError):
            raise CommandError(f"Invalid {field} timestamp at CSV line {line}.") from None
        values[field] = stamp
    values["source_fingerprint"] = hashlib.sha256(json.dumps(
        row, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ).encode()).hexdigest()
    return values


class Command(BaseCommand):
    help = "Atomically import provider credential rows; existing identical source rows are skipped."

    def add_arguments(self, parser):
        parser.add_argument("path", help="CSV path, or - to read standard input.")
        parser.add_argument("--dry-run", action="store_true", help="Validate every CSV row without writing to the database.")

    def handle(self, *args, **options):
        try:
            source_context = nullcontext(sys.stdin) if options["path"] == "-" else open(options["path"], encoding="utf-8-sig", newline="")
            with source_context as source:
                reader = csv.DictReader(source)
                if reader.fieldnames:
                    reader.fieldnames[0] = reader.fieldnames[0].removeprefix("\ufeff")
                if not reader.fieldnames or len(reader.fieldnames) != len(COLUMNS) or set(reader.fieldnames) != set(COLUMNS):
                    raise CommandError("The CSV must contain exactly the ten supported column names.")
                if options["dry_run"]:
                    count = sum(1 for _ in self.rows(reader))
                    self.stdout.write(f"Validated {count} rows; no database changes made.")
                    return
                with transaction.atomic():
                    lock_key_pool()
                    inserted = skipped = 0
                    batch = []
                    for row, values in self.rows(reader):
                        batch.append((row, values))
                        if len(batch) == 500:
                            added, unchanged = self.import_batch(batch)
                            inserted += added
                            skipped += unchanged
                            batch = []
                    if batch:
                        added, unchanged = self.import_batch(batch)
                        inserted += added
                        skipped += unchanged
                self.stdout.write(f"Imported {inserted} rows; skipped {skipped} identical existing rows.")
        except (OSError, UnicodeError, csv.Error):
            raise CommandError("The CSV could not be read; verify its encoding and structure.") from None
        except IntegrityError:
            raise CommandError("The import conflicted with existing database rows; no changes were committed.") from None

    def rows(self, reader):
        seen = set()
        for row in reader:
            values = parse_row(row, reader.line_num)
            if values["id"] in seen:
                raise CommandError(f"Duplicate ID at CSV line {reader.line_num}.")
            seen.add(values["id"])
            yield row, values

    def import_batch(self, batch):
        existing = dict(OCRProviderKey.objects.filter(id__in=[values["id"] for _, values in batch]).values_list("id", "source_fingerprint"))
        records = []
        skipped = 0
        for row, values in batch:
            if values["id"] in existing:
                if existing[values["id"]] != values["source_fingerprint"]:
                    raise CommandError("An existing source ID has different imported content; no changes were committed.")
                skipped += 1
                continue
            plaintext = row["api_key"]
            values["api_key_ciphertext"] = encrypt_api_key(plaintext) if plaintext else ""
            values["api_key_fingerprint"] = fingerprint_api_key(plaintext.strip()) if plaintext.strip() else ""
            records.append(OCRProviderKey(**values))
        OCRProviderKey.objects.bulk_create(records, batch_size=500)
        return len(records), skipped
