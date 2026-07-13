# 產出 wordinfo.json：候選目標字的字頻與釋義（設計文件 §5 步驟 1、3；§6.3）。
# 收錄條件：3–7 字母、純字母、zipf 字頻 >= 3.0、WordNet 有釋義、ECDICT 有中文翻譯——
# 目標字必須「常見且查得到釋義」，bonus 判定另走完整 ENABLE，不經這份資料。
# 字頻：wordfreq（MIT）；英文釋義：WordNet 3.x via NLTK（WordNet License，聲明見 index.html 關於區）；
# 中文釋義：ECDICT（MIT）為簡體，以 OpenCC s2twp 轉為台灣正體。
import csv
import json
import os

import nltk
from opencc import OpenCC
from wordfreq import zipf_frequency

nltk.download("wordnet", quiet=True)
from nltk.corpus import wordnet as wn

here = os.path.dirname(__file__)

# ECDICT 的 translation 欄以字面 "\n" 分隔多個詞性義項，取第一行短釋義即可（§6.3 同一原則）
cc = OpenCC("s2twp")
zh_trans = {}
with open(os.path.join(here, "data", "ecdict.csv"), newline="") as f:
    for row in csv.DictReader(f):
        w = row["word"].lower()
        if row["translation"] and w not in zh_trans:
            zh_trans[w] = cc.convert(row["translation"].split("\\n")[0].strip())

info = {}
with open(os.path.join(here, "data", "enable1.txt")) as f:
    for line in f:
        w = line.strip()
        if not (3 <= len(w) <= 7 and w.isalpha()):
            continue
        z = zipf_frequency(w, "en")
        if z < 3.0:
            continue
        synsets = wn.synsets(w)
        if not synsets:
            continue
        definition = synsets[0].definition()  # 第一個常用義的一句短釋義即可（§6.3）
        if not definition or w not in zh_trans:
            continue
        info[w] = {"z": round(z, 2), "def": definition, "zh": zh_trans[w]}

with open(os.path.join(here, "data", "wordinfo.json"), "w") as f:
    json.dump(info, f, indent=0, sort_keys=True, ensure_ascii=False)
print(f"wordinfo.json：{len(info)} 個候選目標字")
