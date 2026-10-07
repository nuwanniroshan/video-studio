# Fargate ARM64 spike checklist (to run later)

The M0 numbers in [`SPIKE.md`](SPIKE.md) were measured on a Mac. The PLAN asks for the same matrix on a
**16 vCPU / 32 GB Fargate ARM64** task. This is the procedure; it needs AWS access, which the M0 session did not have.

## 1. Build and push the image

```bash
docker buildx build --platform linux/arm64 -f docker/Dockerfile.render -t <acct>.dkr.ecr.<region>.amazonaws.com/studio-render:spike --push .
```

## 2. Task definition

- `runtimePlatform`: `{ cpuArchitecture: ARM64, operatingSystemFamily: LINUX }`
- `cpu: 16384`, `memory: 32768`, ephemeral storage 40 GiB
- Container `command`: `["scripts/spike-bench.sh"]` is a bash script, so override the entrypoint:
  `entryPoint: ["bash","-lc"]`, `command: ["scripts/spike-bench.sh fargate-15w 15 /tmp/b.jsonl && cat /tmp/b.jsonl"]`
- Logs to CloudWatch (`awslogs`); the JSON lines are the results.
- Launch type FARGATE (on-demand) for the measurement. Repeat once on FARGATE_SPOT to confirm there's no difference.

## 3. Runs

| Run | Command (inside the container) |
|---|---|
| Tier matrix + stress probes | `scripts/spike-bench.sh fargate-15w 15` |
| Worker scaling (cinema) | `for w in 6 8 12 15 16; do npx tsx packages/render/scripts/spike.ts bench title cinema $w 8; done` |
| Longer clip (steadier fps) | `npx tsx packages/render/scripts/spike.ts bench title cinema 15 8` ×3, take the median |

Record **outputFps** and **capturesPerSec** per run, plus task start latency (RunTask → RUNNING) with and without a SOCI index.

## 4. What to decide from it

1. Workers per task. PLAN guesses ~6 per 16 vCPU; in the container on the Mac, scaling was near-linear up to the CPU count (see SPIKE.md), so expect 12–15.
2. Cost per output-minute = `$/h ÷ 3600 × (60 × fps_out ÷ outputFps)`; on Spot at ~$0.20/h.
3. Whether `standard` (30 fps, 2 sub-frames) meets the M2 target: a 60 s 1080p30 final in under 10 min of wall time, across at most 4 tasks.
4. Whether blur, 3D or shadow costs justify lint caps (for example, a maximum blur radius) on Fargate.
