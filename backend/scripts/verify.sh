#!/usr/bin/env bash
#
# 后端本地验收单一入口（对应 AGENTS.md §7 的 backend 部分）。
#
# 用途：一条命令串联 §TEST-6 与 REV-1 / REV-2 / REV-3 的必需检查，
# 任一步失败立即停止并以该步的退出码退出；每步打印标题与耗时，全部通过时打印总耗时。
# 只读：不向仓库写任何文件，可重复执行。
#
# 用法（必须从 backend/ 目录执行）：
#
#   cd backend && bash scripts/verify.sh
#
# 本机覆盖不到、必须由 CI 承担的检查见 scripts/README.md。

set -euo pipefail

if [[ ! -f go.mod ]]; then
  echo "verify.sh 必须在 backend/ 目录执行（当前目录没有 go.mod）" >&2
  exit 2
fi

# now_ns 返回当前时间（纳秒）。GNU date 支持 %N；缺少该字段的平台退化为秒级精度。
now_ns() {
  local stamp
  stamp="$(date +%s%N)"
  if [[ "${stamp}" == *N ]]; then
    stamp="$(($(date +%s) * 1000000000))"
  fi
  printf '%s' "${stamp}"
}

# print_elapsed 打印起点与终点（纳秒）之间的耗时。
print_elapsed() {
  local start_ns="$1"
  local end_ns="$2"
  local delta_ns=$((end_ns - start_ns))
  printf '    耗时 %d.%03d 秒\n' "$((delta_ns / 1000000000))" "$(((delta_ns / 1000000) % 1000))"
}

# run_step 打印步骤标题，执行传入命令并统计耗时；失败时以该命令的退出码退出。
run_step() {
  local name="$1"
  shift
  echo "==> ${name}"
  local start_ns
  start_ns="$(now_ns)"
  local status=0
  set +e
  "$@"
  status=$?
  set -e
  print_elapsed "${start_ns}" "$(now_ns)"
  if [[ "${status}" -ne 0 ]]; then
    echo "失败：${name}（退出码 ${status}）" >&2
    exit "${status}"
  fi
}

total_start_ns="$(now_ns)"

run_step "go build ./..." go build ./...
run_step "go vet ./..." go vet ./...
run_step "go run ./tools/structurecheck" go run ./tools/structurecheck
run_step "go run ./tools/apicheck" go run ./tools/apicheck
run_step "go test ./... -count=1" go test ./... -count=1

echo "全部通过"
print_elapsed "${total_start_ns}" "$(now_ns)"
