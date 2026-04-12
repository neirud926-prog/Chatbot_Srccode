from providers.base import AIProvider


def get_provider(name: str, settings: dict) -> AIProvider:
    name = name.lower()
    if name == "nltk":
        from providers.nltk_provider import NLTKProvider
        return NLTKProvider(settings)
    elif name == "huggingface":
        from providers.huggingface_provider import HuggingFaceProvider
        return HuggingFaceProvider(settings)
    elif name == "gemma":
        from providers.gemma_provider import GemmaProvider
        return GemmaProvider(settings)
    else:
        raise ValueError(f"Unknown provider: {name!r}. Choose from: nltk, huggingface, gemma")
