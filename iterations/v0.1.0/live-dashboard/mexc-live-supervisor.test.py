import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mexc_supervisor', Path(__file__).with_name('mexc-live-supervisor.py'))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)

class SupervisorTests(unittest.TestCase):
    def test_pressure_thresholds_and_disk_guard(self):
        self.assertIsNone(M.resource_reason(260, 6000))
        self.assertIsNotNone(M.resource_reason(219, 6000))
        self.assertIsNone(M.resource_reason(100, 6000, running=True))
        self.assertIsNotNone(M.resource_reason(79, 6000, running=True))
        self.assertIsNotNone(M.resource_reason(1000, 511))

    def test_existing_live_worker_blocks_and_dead_pid_lock_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'lock'
            path.write_text(str(os.getpid()))
            with self.assertRaises(RuntimeError):
                M.acquire_lock(path)
            path.write_text('2147483647')
            lock = M.acquire_lock(path)
            self.assertEqual(path.read_text(), str(os.getpid()))
            try:
                with self.assertRaises(BlockingIOError):
                    M.acquire_lock(path)
            finally:
                lock.close()

    def test_markets_run_in_order_and_failure_defers_remaining_market(self):
        for fail in (False, True):
            with tempfile.TemporaryDirectory() as directory:
                service = M.Supervisor(directory)
                calls = []
                def collect(market):
                    calls.append(market)
                    return (not fail, 60 if fail else 0)
                service.collect = collect
                self.assertEqual(service.run(once=True), not fail)
                self.assertEqual(calls, ['USDT'] if fail else ['USDT', 'USDD'])
                self.assertFalse((Path(directory) / 'data/mexc-worker.lock').exists())

    def test_guard_never_launches_child_when_existing_dashboard_is_unhealthy(self):
        with tempfile.TemporaryDirectory() as directory:
            service = M.Supervisor(directory)
            service.guard = lambda: '现有看板接口响应异常'
            with patch.object(M.subprocess, 'Popen') as start:
                self.assertEqual(service.collect('USDT'), (False, 60))
                start.assert_not_called()
            saved = json.loads(service.status_path.read_text())
            self.assertEqual(saved['phase'], 'paused')
            self.assertTrue(saved['enabled'])

    def test_rate_limited_child_causes_cooldown_and_preserves_last_results(self):
        with tempfile.TemporaryDirectory() as directory:
            service = M.Supervisor(directory)
            service.guard = lambda: None
            class Child:
                returncode = 0
                def __init__(self, command, **kwargs):
                    kwargs['stdout'].write(json.dumps({'market': 'USDT', 'requests': 1, 'rateLimited': True}) + '\n')
                def poll(self):
                    return 0
            with patch.object(M.subprocess, 'Popen', Child):
                self.assertEqual(service.collect('USDT'), (False, 900))
            saved = json.loads(service.status_path.read_text())
            self.assertEqual(saved['phase'], 'paused')
            self.assertEqual(saved['markets']['USDT']['requests'], 1)
            self.assertTrue(saved['markets']['USDT']['rateLimited'])

if __name__ == '__main__':
    unittest.main()
