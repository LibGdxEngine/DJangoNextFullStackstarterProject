from django.test import TestCase
from apps.accounts.phone import normalize_phone, mask_phone


class PhoneNormalizationTests(TestCase):
    def test_normalize_local_egyptian_phone(self):
        canonical = normalize_phone("01039811349", default_region="EG")
        self.assertEqual(canonical, "+201039811349")

    def test_normalize_canonical_e164(self):
        canonical = normalize_phone("+201039811349")
        self.assertEqual(canonical, "+201039811349")

    def test_normalize_phone_with_whitespace_and_symbols(self):
        canonical = normalize_phone(" 010 3981-1349 ", default_region="EG")
        self.assertEqual(canonical, "+201039811349")

    def test_invalid_phone_raises_value_error(self):
        with self.assertRaises(ValueError):
            normalize_phone("not-a-phone-number")

    def test_empty_phone_raises_value_error(self):
        with self.assertRaises(ValueError):
            normalize_phone("")

    def test_mask_phone(self):
        masked = mask_phone("+201039811349")
        self.assertTrue(masked.startswith("+2010"))
        self.assertTrue(masked.endswith("49"))
        self.assertIn("*", masked)
