import time

import httpx

from .base import BaseLLMProvider, LLMResponse


class OllamaProvider(BaseLLMProvider):

    def __init__(self, base_url: str, model: str = "mistral:7b-instruct-q4_0") -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 120.0,
    ) -> LLMResponse:
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{self._base_url}/api/chat",
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_prompt},
                    ],
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                    },
                },
            )
        resp.raise_for_status()
        data = resp.json()

        return LLMResponse(
            text=data["message"]["content"],
            tokens_input=data.get("prompt_eval_count", 0),
            tokens_output=data.get("eval_count", 0),
            provider="ollama",
            model=self._model,
            latency_ms=int((time.monotonic() - start) * 1000),
        )
