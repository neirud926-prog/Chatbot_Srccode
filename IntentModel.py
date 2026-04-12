import os
import numpy
import random
import json
import nltk
from keras import models, layers
from nltk.stem.lancaster import LancasterStemmer
from pathlib import Path
from nltk.tokenize import word_tokenize
nltk.download('punkt')

class IntentModel:
    model:models
    intent_file_path:str
    stemmer:LancasterStemmer
    words:list
    labels:list
    data:dict

    def __init__(self, intent_file_path, force_retrain=False, epochs_list=[5, 10, 15, 20], batch_size_list=[4, 8, 16, 32, 64]) -> None:
        self.intent_file_path = intent_file_path
        self.stemmer = LancasterStemmer()
        self.labels, self.words, docs_x, docs_y, self.data = self.read_intent()

        model_path = "{}/rsc/models/{}.keras".format(Path(__file__).parent, Path(intent_file_path).stem)

        loaded = False
        if os.path.exists(model_path) and not force_retrain:
            try:
                self.model = models.load_model(model_path)
                loaded = True
            except Exception as e:
                print(f"[IntentModel] Could not load {model_path} ({e}). Retraining...", flush=True)

        if not loaded:
            training, output = self.make_BOW(self.labels, self.words, docs_x, docs_y)

            best_epochs = None
            best_batch_size = None
            best_accuracy = None

            for epochs in epochs_list:
                for batch_size in batch_size_list:
                    # Define the model
                    tmp_model = models.Sequential()
                    tmp_model.add(layers.Input(shape=(len(training[0]),)))             # Input layer
                    tmp_model.add(layers.Dense(8, activation='relu'))                  # First hidden layer
                    tmp_model.add(layers.Dense(8, activation='relu'))                  # Second hidden layer
                    tmp_model.add(layers.Dense(len(output[0]), activation='softmax'))  # Output layer

                    # Compile the model
                    tmp_model.compile(optimizer='adam',
                                    loss='categorical_crossentropy',
                                    metrics=['accuracy'])

                    tmp_model.summary()

                    history = tmp_model.fit(training, output, epochs=epochs, batch_size=batch_size, verbose=0)
                    accuracy = max(history.history['accuracy'])

                    if best_accuracy is None or accuracy > best_accuracy:
                        best_accuracy = accuracy
                        best_epochs = epochs
                        best_batch_size = batch_size
                        self.model = tmp_model

            print("===== {} =====".format(Path(intent_file_path).stem))
            print(" Epochs: ", best_epochs)
            print(" Batch Size: ", best_batch_size)
            print(" Accuracy: ", best_accuracy)
            self.model.save(model_path)
        pass

    def read_intent(self):
        with open(self.intent_file_path) as file:
            data = json.load(file)
        words = []
        labels = []
        docs_x = []
        docs_y = []
        
        for intent in data["intents"]:
            for pattern in intent["patterns"]:
                wrds = word_tokenize(pattern)
                words.extend(wrds)
                docs_x.append(wrds)
                docs_y.append(intent["tag"])

            if intent["tag"] not in labels:
                labels.append(intent["tag"])

        words = [self.stemmer.stem(w.lower()) for w in words if w != "?"]
        words = sorted(list(set(words)))
        labels = sorted(labels)
        return labels, words, docs_x, docs_y, data

    def make_BOW(self, labels, words, docs_x, docs_y):
        training = []
        output = []
        out_empty = [0 for _ in range(len(labels))]

        for x, doc in enumerate(docs_x):
            bag = []
            wrds = [self.stemmer.stem(w.lower()) for w in doc]

            for w in words:
                if w in wrds:
                    bag.append(1)
                else:
                    bag.append(0)

            output_row = out_empty[:]
            output_row[labels.index(docs_y[x])] = 1
            training.append(bag)
            output.append(output_row)

        return numpy.array(training), numpy.array(output)
    
    def bag_of_words(self, s, words):
        bag = [0 for _ in range(len(words))]

        s_words = word_tokenize(s)
        s_words = [self.stemmer.stem(word.lower()) for word in s_words]

        for se in s_words:
            for i, w in enumerate(words):
                if w == se:
                    bag[i] = 1

        return numpy.array(bag)
    
    def predict_intent(self, input_str, result_tag=['responses']):
        ip = self.bag_of_words(input_str, self.words)
        ip = numpy.array(ip).reshape(1, -1)

        results = self.model.predict(ip, verbose=0)
        results_index = numpy.argmax(results)
        tag = self.labels[results_index]

        result = list()
        for tg in self.data["intents"]:
            if tg['tag'] == tag:
                for r_tg in result_tag:
                    if isinstance(tg[r_tg], list):
                        result.append(random.choice(tg[r_tg]))
                    else:
                        result.append(tg[r_tg])
                
        return result