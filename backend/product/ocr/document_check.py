"""Standalone child process: no Django imports, credentials, or parser output.

Resource limits contain malformed document exhaustion; they are not an OS sandbox
or a guarantee that a document is malware-free. Deploy workers with least privilege.
"""

import os
import resource
import sys
import warnings


def restrict_syscalls():
    """Restrict parsing to existing descriptors; fail closed on unsupported hosts."""
    import ctypes
    import errno

    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise OSError("Cannot constrain parser privileges")
    seccomp = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    context = seccomp.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not context:
        raise OSError("Cannot initialize parser constraints")
    try:
        for name in (
            b"socket", b"socketpair", b"connect", b"bind", b"listen", b"accept",
            b"accept4", b"sendto", b"sendmsg", b"sendmmsg", b"execve", b"execveat",
            b"fork", b"vfork", b"clone", b"clone3", b"ptrace", b"process_vm_readv",
            b"process_vm_writev", b"io_uring_setup", b"bpf", b"mount", b"unshare",
            b"open", b"openat", b"openat2", b"open_by_handle_at", b"creat",
            b"unlink", b"unlinkat", b"rename", b"renameat", b"renameat2",
            b"truncate", b"truncate64", b"ftruncate", b"ftruncate64",
            b"chmod", b"fchmod", b"fchmodat", b"fchmodat2",
            b"chown", b"chown32", b"fchown", b"fchown32", b"lchown", b"lchown32", b"fchownat",
            b"link", b"linkat", b"symlink", b"symlinkat", b"mkdir", b"mkdirat",
            b"rmdir", b"mknod", b"mknodat", b"utime", b"utimes", b"futimesat", b"utimensat",
            b"setxattr", b"lsetxattr", b"fsetxattr", b"removexattr", b"lremovexattr", b"fremovexattr",
            b"kill", b"tkill", b"tgkill", b"pidfd_open", b"pidfd_getfd", b"pidfd_send_signal",
            b"rt_sigqueueinfo", b"rt_tgsigqueueinfo", b"reboot", b"swapon", b"swapoff",
            b"chroot", b"pivot_root", b"umount", b"umount2", b"move_mount", b"fsopen",
            b"fsmount", b"fspick", b"fsconfig", b"mount_setattr", b"setns",
            b"prlimit64", b"setrlimit", b"process_madvise", b"process_mrelease",
            b"name_to_handle_at",
        ):
            syscall = seccomp.seccomp_syscall_resolve_name(name)
            if syscall >= 0 and seccomp.seccomp_rule_add(context, 0x00050000 | errno.EPERM, syscall, 0) != 0:
                raise OSError("Cannot install parser constraints")
        if seccomp.seccomp_load(context) != 0:
            raise OSError("Cannot activate parser constraints")
    finally:
        seccomp.seccomp_release(context)


def check_image(document, content_type, max_pixels):
    from PIL import Image, ImageFile

    Image.MAX_IMAGE_PIXELS = max_pixels
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    expected = {"image/png": "PNG", "image/jpeg": "JPEG"}[content_type]
    with Image.open(document, formats=[expected]) as image:
        if image.format != expected or image.width * image.height > max_pixels:
            raise ValueError("Image limit exceeded")
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError("Animated documents are unsupported")
        image.verify()
    document.seek(0)
    with Image.open(document, formats=[expected]) as image:
        image.load()


def check_pdf(document, max_pages):
    from pypdf import PdfReader
    from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject

    # Traverse raw dictionary values, never request stream.get_data(). Object
    # streams may still be decoded by the parser within this process's limits.
    forbidden_keys = {
        "/AA", "/OpenAction", "/JS", "/JavaScript", "/EmbeddedFiles", "/EF",
        "/XFA", "/RichMediaContent", "/RichMediaSettings", "/Collection",
        "/AcroForm", "/A", "/AF", "/PresSteps", "/Alternates", "/Ref",
    }
    forbidden_types = {"/EmbeddedFile", "/Filespec", "/Action"}
    forbidden_subtypes = {"/RichMedia", "/Movie", "/Sound", "/Screen", "/3D", "/FileAttachment", "/Widget"}
    reader = PdfReader(document, strict=True)
    if reader.is_encrypted:
        raise ValueError("Encrypted PDFs are unsupported")
    if not 0 < len(reader.pages) <= max_pages:
        raise ValueError("PDF page limit exceeded")
    queue = [reader.trailer]
    seen_refs = set()
    seen_objects = set()
    budget = 100_000
    while queue:
        budget -= 1
        if budget < 0 or len(queue) > 100_000:
            raise ValueError("PDF structure is too complex")
        node = queue.pop()
        if isinstance(node, IndirectObject):
            key = (node.idnum, node.generation)
            if key in seen_refs:
                continue
            seen_refs.add(key)
            queue.append(node.get_object())
        elif isinstance(node, DictionaryObject):
            if id(node) in seen_objects:
                continue
            seen_objects.add(id(node))
            if forbidden_keys.intersection(node.keys()):
                raise ValueError("Active PDF content is unsupported")
            if node.get("/Type") in forbidden_types or node.get("/Subtype") in forbidden_subtypes:
                raise ValueError("Active PDF content is unsupported")
            # External stream references and multimedia must not reach the GPU.
            if "/F" in node and ("/Filter" in node or "/Length" in node):
                raise ValueError("External streams are unsupported")
            queue.extend(node.values())
        elif isinstance(node, ArrayObject):
            if id(node) in seen_objects:
                continue
            seen_objects.add(id(node))
            queue.extend(node)


def main():
    path, content_type, seconds, memory_mb, max_pixels, max_pages, max_bytes = sys.argv[1:]
    resource.setrlimit(resource.RLIMIT_CPU, (max(1, int(seconds)), max(1, int(seconds))))
    memory = int(memory_mb) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
    # Load trusted modules before denying filesystem access. No document bytes
    # are parsed until the filter is installed; only this read-only fd survives.
    import pypdf  # noqa: F401
    from PIL import Image, ImageFile, JpegImagePlugin, PngImagePlugin, TiffImagePlugin  # noqa: F401

    Image.preinit()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as document:
        if not 0 < os.fstat(document.fileno()).st_size <= int(max_bytes):
            raise ValueError("Invalid document size")
        restrict_syscalls()
        if content_type == "application/pdf":
            check_pdf(document, int(max_pages))
        else:
            check_image(document, content_type, int(max_pixels))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(1)
