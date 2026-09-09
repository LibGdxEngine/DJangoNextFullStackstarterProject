#!/bin/sh
# Installed root-owned as /usr/local/bin/mobser-ssh-dispatch.
set -eu
request=${SSH_ORIGINAL_COMMAND-}
case "$request" in
    *[!0-9\ deploy]*|'') exit 64 ;;
esac
# No expansion of caller text as executable shell syntax.
printf '%s\n' "$request" | /usr/bin/grep -Eq '^deploy [1-9][0-9]{0,19} [1-9][0-9]{0,8}$' || exit 64
set -f
set -- $request
exec /usr/bin/sudo -n /usr/local/sbin/mobser-deploy "$@"
