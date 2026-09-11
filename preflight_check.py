import os
import requests
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

def print_status(component: str, status: str, details: str = ""):
    status_symbol = "PASS" if status == "PASS" else "FAIL"
    detail_str = f" - {details}" if details else ""
    print(f"[{status_symbol}] {component}{detail_str}")

def run_preflight():
    print("=" * 65)
    print("         RIME VOICE AGENT PREFLIGHT CHECK & DIAGNOSTICS")
    print("=" * 65)
    print()

    all_passed = True

    # 1. Check Environment Variables
    livekit_url = os.getenv("LIVEKIT_URL")
    livekit_api_key = os.getenv("LIVEKIT_API_KEY")
    livekit_api_secret = os.getenv("LIVEKIT_API_SECRET")
    deepgram_key = os.getenv("DEEPGRAM_API_KEY")
    rime_key = os.getenv("RIME_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    missing = []
    if not livekit_url: missing.append("LIVEKIT_URL")
    if not livekit_api_key: missing.append("LIVEKIT_API_KEY")
    if not livekit_api_secret: missing.append("LIVEKIT_API_SECRET")
    if not deepgram_key: missing.append("DEEPGRAM_API_KEY")
    if not rime_key: missing.append("RIME_API_KEY")
    if not (groq_key or gemini_key or openai_key):
        missing.append("GROQ_API_KEY (or GEMINI_API_KEY / OPENAI_API_KEY)")

    if missing:
        print_status("Environment Configuration", "FAIL", f"Missing variables: {', '.join(missing)}")
        print("\n--> Please update your .env file with the missing credentials.")
        all_passed = False
    else:
        print_status("Environment Configuration", "PASS", "All required secrets are present.")

    # 2. Test Groq LLM
    if groq_key:
        print("\nTesting Groq LLM API connection...")
        try:
            groq_model = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
            res = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {groq_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": groq_model,
                    "messages": [{"role": "user", "content": "Respond with 'OK'"}],
                    "max_tokens": 5
                },
                timeout=8
            )
            if res.status_code == 200:
                reply = res.json()["choices"][0]["message"]["content"].strip()
                print_status("Groq LLM", "PASS", f"Model response ({groq_model}): '{reply}'")
            else:
                print_status("Groq LLM", "FAIL", f"HTTP {res.status_code}: {res.text}")
                all_passed = False
        except Exception as e:
            print_status("Groq LLM", "FAIL", f"Connection error: {str(e)}")
            all_passed = False
            
    elif gemini_key:
        print("\nTesting Google Gemini API connection...")
        try:
            from google import genai
            client = genai.Client(api_key=gemini_key)
            response = client.models.generate_content(
                model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
                contents="Respond with the word 'OK' only.",
            )
            reply = response.text.strip() if response.text else "OK"
            print_status("Google Gemini LLM", "PASS", f"Model response: '{reply}'")
        except Exception as e:
            print_status("Google Gemini LLM", "FAIL", f"Error: {str(e)}")
            all_passed = False

    # 3. Test Rime TTS Connection
    if rime_key:
        print("\nTesting connection to Rime TTS API...")
        url = "https://users.rime.ai/v1/rime-tts"
        headers = {
            "Authorization": f"Bearer {rime_key}",
            "Content-Type": "application/json",
            "Accept": "audio/wav"
        }
        voice = os.getenv("RIME_VOICE_ID", "eva")
        model = os.getenv("RIME_MODEL_ID", "mistv2")
        
        data = {
            "text": "Preflight check successful. Rime voice synthesis and Groq LLM are fully operational.",
            "speaker": voice,
            "modelId": model,
            "lang": "eng"
        }

        try:
            response = requests.post(url, headers=headers, json=data, timeout=10)
            if response.status_code == 200:
                output_filename = "preflight_output.wav"
                with open(output_filename, "wb") as f:
                    f.write(response.content)
                print_status("Rime TTS Synthesis", "PASS", f"Audio clip generated -> {output_filename}")
            else:
                print_status("Rime TTS Synthesis", "FAIL", f"HTTP {response.status_code}: {response.text}")
                all_passed = False
        except Exception as e:
            print_status("Rime TTS Synthesis", "FAIL", f"Connection error: {str(e)}")
            all_passed = False

    # 4. Test Deepgram API Key format / connectivity
    if deepgram_key:
        print("\nTesting Deepgram STT API connection...")
        try:
            dg_res = requests.get(
                "https://api.deepgram.com/v1/projects",
                headers={"Authorization": f"Token {deepgram_key}"},
                timeout=8
            )
            if dg_res.status_code in (200, 201):
                print_status("Deepgram STT", "PASS", "API key authenticated successfully.")
            else:
                print_status("Deepgram STT", "FAIL", f"HTTP {dg_res.status_code}: {dg_res.text}")
                all_passed = False
        except Exception as e:
            print_status("Deepgram STT", "FAIL", f"Connection error: {str(e)}")
            all_passed = False

    # 5. Check LiveKit URL format
    if livekit_url:
        if livekit_url.startswith("wss://") or livekit_url.startswith("ws://"):
            print_status("LiveKit URL", "PASS", f"URL scheme valid: {livekit_url}")
        else:
            print_status("LiveKit URL", "FAIL", f"Invalid URL scheme (must start with ws:// or wss://): {livekit_url}")
            all_passed = False

    print()
    print("=" * 65)
    if all_passed:
        print(" SUCCESS: ALL SYSTEMS OPERATIONAL AND READY TO RUN!")
    else:
        print(" ATTENTION: Some checks failed. Please review the items above.")
    print("=" * 65)
    return all_passed

if __name__ == "__main__":
    run_preflight()