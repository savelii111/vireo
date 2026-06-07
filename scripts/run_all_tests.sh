#!/usr/bin/env bash
# Run all vireo tests, capture failures
set +e
cd ~/OneDrive/случайный\ проект/vireo

OUT=/tmp/vireo_test_run
rm -rf "$OUT" && mkdir -p "$OUT"

# JS tests
echo "=== JS TESTS ===" | tee "$OUT/summary.log"
for f in $(find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./.pytest_cache -prune -o \( -name "test_*.js" -o -name "*.test.js" \) -print 2>/dev/null | grep -v "node_modules\|.git/\|.pytest_cache\|tmp_\|debug"); do
  name=$(echo "$f" | tr '/' '_')
  logfile="$OUT/${name}.log"
  result=$(timeout 60 node --test "$f" 2>&1)
  ec=$?
  if [ $ec -ne 0 ]; then
    echo "FAIL  $f" | tee -a "$OUT/summary.log"
    echo "$result" > "$logfile"
  else
    # extract pass/fail counts
    stats=$(echo "$result" | grep -E "^# (tests|pass|fail|skipped|cancelled)" | tr '\n' ' ')
    echo "PASS  $f  $stats" | tee -a "$OUT/summary.log"
  fi
done

echo "" | tee -a "$OUT/summary.log"
echo "=== PYTHON TESTS ===" | tee -a "$OUT/summary.log"
for f in $(find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./.pytest_cache -prune -o -path ./build -prune -o -name "test_*.py" -print 2>/dev/null | grep -v "node_modules\|.git/\|.pytest_cache\|/build/\|tmp_\|debug"); do
  name=$(echo "$f" | tr '/' '_')
  logfile="$OUT/${name}.log"
  result=$(timeout 60 python -m pytest "$f" --tb=line -q 2>&1)
  ec=$?
  if [ $ec -ne 0 ]; then
    echo "FAIL  $f" | tee -a "$OUT/summary.log"
    echo "$result" > "$logfile"
  else
    stats=$(echo "$result" | tail -1)
    echo "PASS  $f  $stats" | tee -a "$OUT/summary.log"
  fi
done

echo "" | tee -a "$OUT/summary.log"
echo "=== SUMMARY ===" | tee -a "$OUT/summary.log"
grep -c "PASS" "$OUT/summary.log" | xargs -I {} echo "PASSED: {}"
grep -c "FAIL" "$OUT/summary.log" | xargs -I {} echo "FAILED: {}"
