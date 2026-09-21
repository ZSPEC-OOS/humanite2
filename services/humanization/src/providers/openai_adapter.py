import asyncio
import time

from openai import AsyncOpenAI

from .base import BaseLLMProvider, LLMResponse


class OpenAIProvider(BaseLLMProvider):

    def __init__(self, api_key: str, model: str = "gpt-3.5-turbo") -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 45.0,
    ) -> LLMResponse:
        start = time.monotonic()
        try:
            resp = await asyncio.wait_for(
                self._client.chat.completions.create(
                    model=self._model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_prompt},
                    ],
                    max_tokens=max_tokens,
                    temperature=temperature,
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(f"OpenAI request timed out after {timeout}s")

        return LLMResponse(
            text=resp.choices[0].message.content or "",
            tokens_input=resp.usage.prompt_tokens,
            tokens_output=resp.usage.completion_tokens,
            provider="openai",
            model=self._model,
            latency_ms=int((time.monotonic() - start) * 1000),
        )
