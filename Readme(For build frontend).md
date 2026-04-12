# 1. Run it one by one
--
cd "frontend"
--
npm install
npm run build:single
--
cd ..
--
conda env create -f conda_environment.yml
--
conda activate SEHS4678
--
pip install --only-binary llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu llama-cpp-python
--
curl.exe -L "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf?download=true" -o "rsc/models/gemma-2-2b-it-Q4_K_M.gguf"
--
# 2. Set .env file

# 3. Verify every REQUIRED runtime dep imports
python -c "import flask, nltk, keras, huggingface_hub; print('all deps ok')"

# 4. (Optional) Verify the Gemma backend imports — only if demoing Gemma
python -c "import llama_cpp; print('gemma ok')"

# 5 Start Backend
python app.py

