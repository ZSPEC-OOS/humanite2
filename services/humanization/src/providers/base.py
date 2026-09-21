from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class LLMResponse:
    text: str
    tokens_input: int
    tokens_output: int
    provider: str
    model: str
    latency_ms: int


class BaseLLMProvider(ABC):

    @abstractmethod
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 45.0,
    ) -> LLMResponse: ...
