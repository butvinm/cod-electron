#!/usr/bin/env node
'use strict';
// Test double for a CLI that ignores SIGINT and SIGTERM and has a tool process running.
const { spawn } = require('node:child_process');
const fs = require('node:fs');

process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
const tool = spawn(process.execPath, ['-e', 'process.on("SIGINT",()=>{});process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore' });
fs.writeFileSync(process.env.STUBBORN_PID_FILE, `${process.pid} ${tool.pid}`);
process.stdin.resume();
setInterval(() => {}, 1000);
