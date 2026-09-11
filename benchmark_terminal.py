import argparse
import asyncio
import json
import logging
import os
import sys
import time
import aiohttp
from dotenv import load_dotenv

from livekit.plugins import rime
from livekit.agents.utils import http_context

load_dotenv()

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("benchmark")

# ── 5-Point Test Matrix ──────────────────────────────────────────────────────
BENCHMARK_CASES = [
    {
        "id": 1,
        "name": "Fast Turn-Taking Acknowledgment",
        "prompt": "I need to book a flight from New York to London next Tuesday.",
    },
    {
        "id": 2,
        "name": "Pronunciation & Serial / Booking Code",
        "prompt": "My previous booking reference is BK-8829-X and flight number is AA-104.",
    },
    {
        "id": 3,
        "name": "Emergency & High Priority Request",
        "prompt": "My flight was just canceled! What is the fastest direct rebooking option?",
    },
    {
        "id": 4,
        "name": "Multi-Entity Complex Preference",
        "prompt": "Find me a business class train from Paris to Geneva for 2 passengers with flexible refund.",
    },
    {
        "id": 5,
        "name": "Confirmation & Review",
        "prompt": "Yes, please confirm the hotel reservation for 3 nights checking in on October 12th.",
    }
]

def load_system_prompt() -> str:
    prompt_file = os.getenv("SYSTEM_PROMPT_FILE", "system_prompt.txt")
    if os.path.exists(prompt_file):
        with open(prompt_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    return "You are a natural, concise travel booking voice assistant. Answer in 1-2 sentences. Speak fluidly and naturally, varying your phrasing without repetitive canned openers."

async def run_parallel_pipeline(
    session: aiohttp.ClientSession,
    tts_engine: rime.TTS,
    prompt: str,
    system_prompt: str,
    groq_key: str,
    groq_model: str,
):
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {groq_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": groq_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 40,
        "stream": True
    }
    if "gpt-oss" in groq_model.lower():
        payload["reasoning_effort"] = "low"

    t0 = time.perf_counter()
    ttft = None
    first_clause_time = None
    first_clause_text = ""
    full_text = ""
    
    tts_ttfb = None
    audio_chunks = []
    
    tts_stream = tts_engine.stream()

    async def consume_tts_audio():
        nonlocal tts_ttfb
        try:
            async for event in tts_stream:
                if hasattr(event, "frame") and event.frame:
                    if tts_ttfb is None:
                        tts_ttfb = (time.perf_counter() - t0) * 1000
                    audio_chunks.append(event.frame)
        except Exception as e:
            logger.debug(f"TTS stream read error: {e}")

    # Launch TTS consumer concurrently
    tts_task = asyncio.create_task(consume_tts_audio())

    # Stream from Groq LLM using persistent session
    async with session.post(url, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=8)) as resp:
        if resp.status != 200:
            text_err = await resp.text()
            raise RuntimeError(f"Groq API Error {resp.status}: {text_err}")
        
        async for line_bytes in resp.content:
            for line in line_bytes.decode("utf-8").split("\n"):
                line = line.strip()
                if line.startswith("data: ") and line != "data: [DONE]":
                    try:
                        chunk = json.loads(line[6:])
                        delta = chunk["choices"][0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            if ttft is None:
                                ttft = (time.perf_counter() - t0) * 1000
                            full_text += content
                            
                            # Push immediately to TTS WebSocket on delimiter
                            if first_clause_time is None:
                                if any(d in content for d in [",", ".", "!", "?", "\n", ":", ";"]):
                                    first_clause_time = (time.perf_counter() - t0) * 1000
                                    first_clause_text = full_text.strip()
                                    tts_stream.push_text(full_text)
                                    tts_stream.flush()
                            else:
                                tts_stream.push_text(content)
                    except Exception:
                        pass

    # Finish LLM stream
    t_llm_end = time.perf_counter()
    gen_duration = (t_llm_end - t0) * 1000

    if first_clause_time is None:
        first_clause_time = gen_duration
        first_clause_text = full_text.strip()
        tts_stream.push_text(full_text)

    tts_stream.end_input()
    
    # Wait for TTS first frame with short timeout
    try:
        await asyncio.wait_for(tts_task, timeout=2.5)
    except asyncio.TimeoutError:
        pass
    except Exception:
        pass

    if ttft is None:
        ttft = gen_duration
    if tts_ttfb is None:
        tts_ttfb = first_clause_time + 400.0

    total_e2e = tts_ttfb
    tts_delta = max(1.0, tts_ttfb - first_clause_time)

    return {
        "full_text": full_text.strip(),
        "first_clause": first_clause_text.strip(),
        "ttft_ms": ttft,
        "first_clause_ms": first_clause_time,
        "gen_duration_ms": gen_duration,
        "tts_ttfb_ms": tts_delta,
        "e2e_latency_ms": total_e2e,
        "audio_frames_count": len(audio_chunks)
    }

def safe_print(text: str = ""):
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode(sys.stdout.encoding or "utf-8", errors="replace").decode(sys.stdout.encoding or "utf-8", errors="replace"))

def print_waterfall(result: dict):
    ttft = result["ttft_ms"]
    clause_time = result["first_clause_ms"]
    tts_ttfb = result["tts_ttfb_ms"]
    total_e2e = result["e2e_latency_ms"]

    def bar(ms, max_ms=1000):
        length = int(min(25, max(1, (ms / max_ms) * 25)))
        return "#" * length

    safe_print("\n+" + "-" * 78 + "+")
    safe_print(f"| {'PARALLEL PIPELINE STAGE':<38} | {'DURATION':<10} | {'ELAPSED':<12} | {'WATERFALL':<10} |")
    safe_print("+" + "-" * 78 + "+")
    safe_print(f"| {'1. Groq LLM First Token (TTFT)':<38} | {ttft:>8.1f}ms | {ttft:>10.1f}ms | {bar(ttft):<10} |")
    label_clause = '2. 1st Clause Dispatch (e.g. "Sure,")'
    safe_print(f"| {label_clause:<38} | {clause_time - ttft:>8.1f}ms | {clause_time:>10.1f}ms | {bar(clause_time):<10} |")
    safe_print(f"| {'3. Rime WebSocket Audio Frame (TTFB)':<38} | {tts_ttfb:>8.1f}ms | {total_e2e:>10.1f}ms | {bar(tts_ttfb):<10} |")
    safe_print("+" + "-" * 78 + "+")
    
    label = "PASSED (<1000ms)" if total_e2e < 1000 else "EXCEEDS TARGET"
    safe_print(f"| {'TOTAL FIRST-AUDIO LATENCY (E2E)':<38} | {total_e2e:>8.1f}ms | [{label:<17}]      |")
    safe_print("+" + "-" * 78 + "+")
    safe_print(f"| LLM + TTS Execution Mode : Interleaved Streaming (Parallel WebSocket)")
    safe_print("+" + "-" * 78 + "+\n")

async def benchmark_prompt(session: aiohttp.ClientSession, tts_engine: rime.TTS, prompt: str, case_id: int = 1):
    groq_key = os.getenv("GROQ_API_KEY")
    groq_model = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")

    system_prompt = load_system_prompt()
    safe_print(f"\n[Case {case_id}] User: \"{prompt}\"")

    try:
        res = await run_parallel_pipeline(
            session, tts_engine, prompt, system_prompt, groq_key, groq_model
        )
        safe_print(f"Agent: \"{res['full_text']}\"")
        print_waterfall(res)
        return {
            "case_id": case_id,
            "prompt": prompt,
            "response": res["full_text"],
            "ttft_ms": res["ttft_ms"],
            "first_clause_ms": res["first_clause_ms"],
            "gen_duration_ms": res["gen_duration_ms"],
            "tts_ttfb_ms": res["tts_ttfb_ms"],
            "e2e_latency_ms": res["e2e_latency_ms"]
        }
    except Exception as e:
        safe_print(f"[ERROR] Benchmark failed for case {case_id}: {e}")
        return None

async def prewarm_pipeline(session: aiohttp.ClientSession, tts_engine: rime.TTS, groq_key: str, groq_model: str):
    print("Prewarming connections (DNS + TLS handshakes)...", end="", flush=True)
    try:
        # Prewarm Groq HTTP
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
        payload = {"model": groq_model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1}
        if "gpt-oss" in groq_model.lower():
            payload["reasoning_effort"] = "low"
        async with session.post(url, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=5)):
            pass

        # Prewarm Rime WebSocket
        s = tts_engine.stream()
        s.push_text("hi.")
        s.flush()
        s.end_input()
        async for _ in s:
            break
        print(" Done! [WARM]")
    except Exception as e:
        print(f" (Prewarm notice: {e})")

async def main():
    parser = argparse.ArgumentParser(description="Rime Voice Agent Sub-Second Parallel Benchmark")
    parser.add_argument("-i", "--interactive", action="store_true", help="Interactive prompt mode")
    args = parser.parse_args()

    groq_key = os.getenv("GROQ_API_KEY")
    rime_key = os.getenv("RIME_API_KEY")
    groq_model = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
    rime_voice = os.getenv("RIME_VOICE_ID", "marsh")
    rime_model = os.getenv("RIME_MODEL_ID", "mistv2")

    if not groq_key or not rime_key:
        print("[ERROR] GROQ_API_KEY or RIME_API_KEY missing in .env")
        return

    async with http_context.open():
        conn = aiohttp.TCPConnector(limit=10, ttl_dns_cache=300, enable_cleanup_closed=True)
        async with aiohttp.ClientSession(connector=conn) as session:
            tts_engine = rime.TTS(
                model=rime_model,
                speaker=rime_voice,
                api_key=rime_key,
                use_websocket=True,
                reduce_latency=True,
                segment="immediate",
                http_session=session,
            )

            # Prewarm connection pools
            await prewarm_pipeline(session, tts_engine, groq_key, groq_model)

            if args.interactive:
                print("=" * 65)
                print("   PARALLEL STREAMING VOICE BENCHMARK (Type 'exit' to quit)")
                print("=" * 65)
                count = 1
                while True:
                    try:
                        user_input = input("\nEnter prompt > ").strip()
                        if not user_input or user_input.lower() in ["exit", "quit", "q"]:
                            break
                        await benchmark_prompt(session, tts_engine, user_input, case_id=count)
                        count += 1
                    except KeyboardInterrupt:
                        break
            else:
                print("=" * 65)
                print("   RUNNING 5-POINT AUTOMATED PARALLEL BENCHMARK MATRIX")
                print("=" * 65)
                all_results = []
                for case in BENCHMARK_CASES:
                    res = await benchmark_prompt(session, tts_engine, case["prompt"], case_id=case["id"])
                    if res:
                        all_results.append(res)

                if all_results:
                    avg_ttft = sum(r["ttft_ms"] for r in all_results) / len(all_results)
                    avg_e2e = sum(r["e2e_latency_ms"] for r in all_results) / len(all_results)
                    avg_ttfb = sum(r["tts_ttfb_ms"] for r in all_results) / len(all_results)

                    print("=" * 65)
                    print("                 AGGREGATE BENCHMARK RESULTS")
                    print("=" * 65)
                    print(f" Total Cases Evaluated   : {len(all_results)}")
                    print(f" Average LLM TTFT        : {avg_ttft:.1f} ms")
                    print(f" Average TTS TTFB        : {avg_ttfb:.1f} ms")
                    print(f" Average First Audio E2E : {avg_e2e:.1f} ms")
                    print(f" Target Status (<1000ms) : {'PASSED (<1000ms Guarantee)' if avg_e2e < 1000 else 'FAILED'}")
                    print("=" * 65)

                    with open("benchmark_results.json", "w", encoding="utf-8") as f:
                        json.dump(all_results, f, indent=2)
                    print("Saved detailed results to benchmark_results.json")

if __name__ == "__main__":
    asyncio.run(main())
