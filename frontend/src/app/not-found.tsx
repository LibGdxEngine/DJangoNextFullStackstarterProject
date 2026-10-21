import { Button } from "@/features/wasel/ui/Button";
import { Logo } from "@/features/wasel/layout/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
      <Logo />
      <div>
        <div className="text-7xl font-bold text-violet">٤٠٤</div>
        <h1 className="mt-3 text-2xl font-bold">هذه الصفحة غير موجودة</h1>
        <p className="mt-2 text-base text-muted">تأكد من الرابط، أو رجوع للصفحة الرئيسية.</p>
      </div>
      <Button href="/" variant="violet">
        رجوع للرئيسية
      </Button>
    </div>
  );
}
