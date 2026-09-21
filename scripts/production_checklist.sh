#!/usr/bin/env bash
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

PASS=0
FAIL=0
WARN=0

pass()  { echo -e "  ${GREEN}[PASS]${RESET} $*"; (( PASS++ ))  || true; }
fail()  { echo -e "  ${RED}[FAIL]${RESET} $*"; (( FAIL++ ))  || true; }
warn()  { echo -e "  ${YELLOW}[WARN]${RESET} $*"; (( WARN++ )) || true; }
header(){ echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── Resolve repo root ─────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo -e "${BOLD}Humanite Production Readiness Checklist${RESET}"
echo "  Repo: $REPO_ROOT"
echo "  Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ─────────────────────────────────────────────────────────────────────────────
header "Git"
# ─────────────────────────────────────────────────────────────────────────────

if git diff --quiet && git diff --cached --quiet; then
  pass "Working tree is clean"
else
  fail "Uncommitted changes present"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "main" ]]; then
  pass "On main branch"
else
  warn "Not on main branch (current: $BRANCH)"
fi

# ─────────────────────────────────────────────────────────────────────────────
header "Dockerfiles — non-root users"
# ─────────────────────────────────────────────────────────────────────────────

for svc in humanization orchestration preprocessing scanner user-management; do
  df="services/$svc/Dockerfile"
  if [[ -f "$df" ]]; then
    if grep -q "adduser --system" "$df" && grep -q "USER appuser" "$df"; then
      pass "$svc: hardened non-root user (UID 1001)"
    else
      fail "$svc: Dockerfile missing non-root user hardening"
    fi
    if grep -q "HEALTHCHECK" "$df"; then
      pass "$svc: HEALTHCHECK directive present"
    else
      fail "$svc: Dockerfile missing HEALTHCHECK"
    fi
    if grep -q "\-\-no-access-log" "$df"; then
      pass "$svc: --no-access-log in CMD"
    else
      fail "$svc: CMD missing --no-access-log"
    fi
  else
    fail "$svc: Dockerfile not found at $df"
  fi
done

# Gateway (distroless)
gw_df="services/gateway/Dockerfile"
if [[ -f "$gw_df" ]]; then
  if grep -q "distroless" "$gw_df" && grep -q "nonroot" "$gw_df"; then
    pass "gateway: distroless nonroot image"
  else
    fail "gateway: not using distroless/nonroot"
  fi
  if grep -q "extldflags" "$gw_df" && grep -q "trimpath" "$gw_df"; then
    pass "gateway: hardened build flags (-extldflags static, -trimpath)"
  else
    fail "gateway: missing hardened build flags"
  fi
else
  fail "gateway: Dockerfile not found"
fi

# ─────────────────────────────────────────────────────────────────────────────
header "Prometheus metrics"
# ─────────────────────────────────────────────────────────────────────────────

if [[ -f "services/shared/metrics.py" ]]; then
  pass "services/shared/metrics.py exists"
else
  fail "services/shared/metrics.py missing"
fi

for svc in humanization orchestration preprocessing scanner user-management; do
  mf="services/$svc/src/main.py"
  if [[ -f "$mf" ]]; then
    if grep -q "prometheus_middleware" "$mf" && grep -q "/metrics" "$mf"; then
      pass "$svc: Prometheus middleware + /metrics endpoint present"
    else
      fail "$svc: missing Prometheus middleware or /metrics endpoint"
    fi
  else
    fail "$svc: src/main.py not found"
  fi
  req="services/$svc/requirements.txt"
  if grep -q "prometheus-client" "$req"; then
    pass "$svc: prometheus-client in requirements.txt"
  else
    fail "$svc: prometheus-client missing from requirements.txt"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
header "GitHub Actions CI/CD"
# ─────────────────────────────────────────────────────────────────────────────

if [[ -f ".github/workflows/ci.yml" ]]; then
  pass ".github/workflows/ci.yml exists"
  if grep -q "cancel-in-progress" ".github/workflows/ci.yml"; then
    pass "CI: concurrency cancel-in-progress configured"
  else
    warn "CI: cancel-in-progress not set"
  fi
else
  fail ".github/workflows/ci.yml missing"
fi

if [[ -f ".github/workflows/cd.yml" ]]; then
  pass ".github/workflows/cd.yml exists"
  if grep -q "deploy-staging" ".github/workflows/cd.yml"; then
    pass "CD: staging deployment job present"
  else
    fail "CD: staging deployment job missing"
  fi
  if grep -q "deploy-production" ".github/workflows/cd.yml"; then
    pass "CD: production deployment job present"
  else
    fail "CD: production deployment job missing"
  fi
else
  fail ".github/workflows/cd.yml missing"
fi

# ─────────────────────────────────────────────────────────────────────────────
header "Kubernetes manifests"
# ─────────────────────────────────────────────────────────────────────────────

for f in \
  infra/k8s/base/orchestration.yaml \
  infra/k8s/base/gateway.yaml \
  infra/k8s/base/kustomization.yaml \
  infra/k8s/overlays/staging/kustomization.yaml \
  infra/k8s/overlays/production/kustomization.yaml; do
  if [[ -f "$f" ]]; then
    pass "$f exists"
  else
    fail "$f missing"
  fi
done

if grep -q "HorizontalPodAutoscaler" infra/k8s/base/orchestration.yaml 2>/dev/null; then
  pass "orchestration: HorizontalPodAutoscaler defined"
else
  fail "orchestration: HorizontalPodAutoscaler missing"
fi

if grep -q "PodDisruptionBudget" infra/k8s/base/orchestration.yaml 2>/dev/null; then
  pass "orchestration: PodDisruptionBudget defined"
else
  fail "orchestration: PodDisruptionBudget missing"
fi

if grep -q "readOnlyRootFilesystem: true" infra/k8s/base/orchestration.yaml 2>/dev/null; then
  pass "orchestration: readOnlyRootFilesystem enforced"
else
  fail "orchestration: readOnlyRootFilesystem not set"
fi

if grep -q "allowPrivilegeEscalation: false" infra/k8s/base/orchestration.yaml 2>/dev/null; then
  pass "orchestration: allowPrivilegeEscalation: false"
else
  fail "orchestration: allowPrivilegeEscalation not set to false"
fi

# YAML syntax check (requires python3)
if command -v python3 &>/dev/null; then
  for f in \
    infra/k8s/base/orchestration.yaml \
    infra/k8s/base/gateway.yaml \
    .github/workflows/ci.yml \
    .github/workflows/cd.yml; do
    if [[ -f "$f" ]]; then
      if python3 -c "import yaml; yaml.safe_load_all(open('$f'))" 2>/dev/null; then
        pass "YAML syntax OK: $f"
      else
        fail "YAML syntax error: $f"
      fi
    fi
  done
else
  warn "python3 not available; skipping YAML syntax checks"
fi

# ─────────────────────────────────────────────────────────────────────────────
header "ML regression gate"
# ─────────────────────────────────────────────────────────────────────────────

if [[ -f "ml/evaluation/benchmarks/scanner_regression.py" ]]; then
  pass "scanner_regression.py exists"
else
  fail "scanner_regression.py missing"
fi

if [[ -f "ml/evaluation/golden_set/create_golden_set.py" ]]; then
  pass "create_golden_set.py exists"
else
  fail "create_golden_set.py missing"
fi

# ─────────────────────────────────────────────────────────────────────────────
header "Playwright E2E tests"
# ─────────────────────────────────────────────────────────────────────────────

if [[ -f "apps/web/playwright.config.ts" ]]; then
  pass "playwright.config.ts exists"
else
  fail "playwright.config.ts missing"
fi

if [[ -f "apps/web/tests/e2e/dashboard.spec.ts" ]]; then
  pass "dashboard.spec.ts exists"
else
  fail "dashboard.spec.ts missing"
fi

if grep -q '"@playwright/test"' apps/web/package.json 2>/dev/null; then
  pass "@playwright/test in package.json devDependencies"
else
  fail "@playwright/test not found in package.json"
fi

# ─────────────────────────────────────────────────────────────────────────────
header "Go gateway build"
# ─────────────────────────────────────────────────────────────────────────────

if command -v go &>/dev/null; then
  if (cd services/gateway && go vet ./... 2>&1); then
    pass "go vet passes"
  else
    fail "go vet failed"
  fi
  if (cd services/gateway && CGO_ENABLED=0 go build ./... 2>&1); then
    pass "go build passes"
  else
    fail "go build failed"
  fi
else
  warn "go not found; skipping gateway build checks"
fi

# ─────────────────────────────────────────────────────────────────────────────
header "Summary"
# ─────────────────────────────────────────────────────────────────────────────

TOTAL=$(( PASS + FAIL + WARN ))
echo ""
echo -e "  ${GREEN}PASS: $PASS${RESET}   ${RED}FAIL: $FAIL${RESET}   ${YELLOW}WARN: $WARN${RESET}   (total: $TOTAL)"
echo ""

if (( FAIL > 0 )); then
  echo -e "${RED}${BOLD}Production readiness check FAILED ($FAIL issue(s) must be resolved).${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}Production readiness check PASSED.${RESET}"
  exit 0
fi
