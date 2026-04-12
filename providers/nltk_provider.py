from pathlib import Path
from providers.base import AIProvider, ChatMessage, ProviderContext


class NLTKProvider(AIProvider):
    name = "nltk"
    supports_generation = False

    def __init__(self, settings: dict):
        from IntentModel import IntentModel

        working_dir = settings.get("working_dir", Path(__file__).parent.parent)
        force_retrain = settings.get("force_retrain", False)
        epochs_list = settings.get("epochs_list", [500])
        batch_size_list = settings.get("batch_size_list", [16])

        self.menu_model = IntentModel(
            f"{working_dir}/rsc/intents/MenuIntents.json",
            force_retrain=force_retrain,
            epochs_list=epochs_list,
            batch_size_list=batch_size_list,
        )
        self.chat_model = IntentModel(
            f"{working_dir}/rsc/intents/ChatIntents.json",
            force_retrain=force_retrain,
            epochs_list=epochs_list,
            batch_size_list=batch_size_list,
        )

    def predict_menu_intent(self, text: str) -> tuple[str, str]:
        result = self.menu_model.predict_intent(text, result_tag=["responses", "tag"])
        return result[0], result[1]

    def predict_chat_intent(self, text: str) -> tuple[str, str]:
        result = self.chat_model.predict_intent(text, result_tag=["responses", "tag"])
        return result[0], result[1]
