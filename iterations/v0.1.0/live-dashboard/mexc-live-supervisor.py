#!/usr/bin/env python3
"""Sequential, bounded MEXC collection. No extra Python packages required."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
PERIOD = 300
MAX_CYCLE_SECONDS = 210
MIN_START_MIB = 220
MIN_RUNNING_MIB = 80
MIN_DISK_MIB = 512
HEALTH_TIMEOUT = 2.5
ENDPOINTS = ('api/snapshot', 'api/xinbi', 'api/xinbi-proxy')

def stamp():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with open(temporary, 'w') as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, ensure_ascii=False, separators=(',', ':'))
    os.replace(temporary, path)

def available_mib():
    values = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    return int(values['MemAvailable'].split()[0]) // 1024

def resource_reason(memory_mib, disk_mib, running=False):
    if memory_mib < (MIN_RUNNING_MIB if running else MIN_START_MIB):
        return '主机可用内存不足，暂停 MEXC 采集以保护现有看板'
    if disk_mib < MIN_DISK_MIB:
        return '磁盘余量不足，暂停 MEXC 采集并保留上次结果'
    return None

def acquire_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        created = True
    except FileExistsError:
        fd = os.open(path, os.O_RDWR)
        created = False
    stream = os.fdopen(fd, 'r+')
    try:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        saved = stream.read().strip()
        if not created:
            if not saved.isdigit():
                raise RuntimeError('已有采集锁未完成写入，等待人工检查或原进程完成')
            try:
                os.kill(int(saved), 0)
            except ProcessLookupError:
                pass
            else:
                raise RuntimeError('另一个 MEXC 采集进程仍在运行')
        stream.seek(0)
        stream.truncate()
        stream.write(str(os.getpid()))
        stream.flush()
        return stream
    except BaseException:
        stream.close()
        raise

class Supervisor:
    def __init__(self, root=ROOT):
        self.root = Path(root)
        self.status_path = self.root / 'data/mexc-live-status.json'
        self.stopped = False
        self.child = None
        try:
            previous = json.loads(self.status_path.read_text())
        except (FileNotFoundError, ValueError):
            previous = {}
        self.status = {'version': 1, 'enabled': True, 'startedAt': stamp(), 'phase': 'starting',
                       'intervalSeconds': PERIOD, 'markets': previous.get('markets', {}),
                       'budget': {'maxRequestsPerMarket': 96, 'requestIntervalMs': 1500,
                                  'cpuQuotaPercent': 20, 'memoryMaxMiB': 256, 'serialMarkets': True}}

    def publish(self, **changes):
        self.status.update(changes)
        self.status['heartbeatAt'] = stamp()
        atomic_json(self.status_path, self.status)

    def guard(self, running=False):
        memory = available_mib()
        reason = resource_reason(memory, shutil.disk_usage(self.root).free // 1024**2, running)
        self.status['availableMemoryMiB'] = memory
        if reason:
            return reason
        measurements = {}
        for endpoint in ENDPOINTS:
            started = time.monotonic()
            try:
                with urllib.request.urlopen('http://127.0.0.1/freeze-risk/' + endpoint, timeout=HEALTH_TIMEOUT) as response:
                    if response.status != 200:
                        raise RuntimeError('HTTP error')
                    response.read()
            except Exception:
                return '现有看板接口响应异常，暂停 MEXC 采集后自动复查'
            elapsed = time.monotonic() - started
            measurements[endpoint] = round(elapsed * 1000)
            if elapsed > HEALTH_TIMEOUT:
                return '现有看板接口变慢，暂停 MEXC 采集后自动复查'
        self.status['dashboardResponseMs'] = measurements
        return None

    def stop_child(self):
        if self.child and self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=5)

    def collect(self, market):
        reason = self.guard()
        if reason:
            self.publish(phase='paused', pauseReason=reason, currentMarket=None)
            return False, 60
        self.publish(phase='running', currentMarket=market, pauseReason=None, nextRunAt=None)
        directory = self.root / 'data/mexc-live'
        directory.mkdir(parents=True, exist_ok=True)
        log_path = directory / (market.lower() + '-last-cycle.log')
        command = [os.environ.get('MEXC_NODE_BIN') or shutil.which('node'), '--max-old-space-size=96',
                   '--max-semi-space-size=2', str(self.root / 'mexc-live-cycle.js'), '--market=' + market]
        started = time.monotonic()
        aborted = None
        with open(log_path, 'w') as log:
            os.chmod(log_path, 0o600)
            self.child = subprocess.Popen(command, cwd=self.root, stdout=log, stderr=subprocess.STDOUT)
            while self.child.poll() is None and not self.stopped:
                try:
                    self.child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
                if self.child.poll() is not None:
                    break
                aborted = self.guard(running=True)
                if time.monotonic() - started > MAX_CYCLE_SECONDS:
                    aborted = '单轮采集超时，保留已保存游标与上次快照，稍后续查'
                self.publish()
                if aborted:
                    break
            self.stop_child()
        if self.stopped:
            return False, 0
        result = None
        if self.child.returncode == 0 and not aborted:
            for line in log_path.read_text().splitlines():
                try:
                    row = json.loads(line)
                    if row.get('market') == market:
                        result = row
                except (ValueError, AttributeError):
                    pass
        if result is None:
            previous = self.status['markets'].get(market, {})
            self.status['markets'][market] = {**previous, 'lastFailureAt': stamp(), 'lastCycleOK': False}
            self.publish(phase='paused', currentMarket=None, pauseReason=aborted or '采集子进程异常退出，保留上次快照；稍后重试')
            return False, 300
        self.status['markets'][market] = {**result, 'lastCycleOK': True}
        if result.get('rateLimited'):
            self.publish(phase='paused', currentMarket=None, pauseReason='TronGrid 限流，MEXC 停采 15 分钟后再试')
            return False, 900
        self.publish(currentMarket=None)
        return True, 0

    def sleep(self, seconds):
        until = time.monotonic() + seconds
        self.publish(nextRunAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + seconds)))
        while not self.stopped and time.monotonic() < until:
            time.sleep(min(10, max(0, until - time.monotonic())))
            self.publish()

    def run(self, once=False):
        lock_path = self.root / 'data/mexc-worker.lock'
        lock = acquire_lock(lock_path)
        try:
            while not self.stopped:
                started = time.monotonic()
                complete, retry = True, 0
                for market in ('USDT', 'USDD'):
                    complete, retry = self.collect(market)
                    if not complete:
                        break
                if complete:
                    self.publish(phase='waiting', currentMarket=None, pauseReason=None)
                if once:
                    return complete
                self.sleep(max(30, PERIOD - (time.monotonic() - started)) if complete else retry)
        finally:
            self.stop_child()
            self.publish(phase='stopped', currentMarket=None)
            if lock_path.exists() and lock_path.read_text().strip() == str(os.getpid()):
                lock_path.unlink()
            lock.close()

if __name__ == '__main__':
    service = Supervisor()
    def stop(*_):
        service.stopped = True
        service.stop_child()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        success = service.run(once='--once' in sys.argv)
        if success is False:
            sys.exit(1)
    except Exception as error:
        print('[mexc-supervisor] ' + str(error), flush=True)
        sys.exit(1)
