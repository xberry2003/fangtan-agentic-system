"""体察研究场景、访前字段与提纲问题提取的稳定词表和纯函数。"""
import re

SCENARIOS = {
    "market": {
        "name": "用户与市场调研", "description": "理解使用场景，发现需求机会", "noun": "调研",
        "steps": ["定义调研目标", "研究背景与方案", "访谈提纲", "开展访谈", "洞察分析", "研究成果"],
        "fields": [
            {"key": "industry", "label": "关注哪个行业？", "options": ["综合 / 暂不限定", "消费零售", "制造业", "文旅服务", "农业与食品", "互联网科技"], "multiple": False},
            {"key": "goal", "label": "本次调研聚焦哪些研究问题？", "options": ["理解使用场景", "识别用户痛点", "探索需求机会", "验证研究假设", "了解市场现状", "发现经营问题", "寻找增长机会", "比较区域差异", "验证一个想法"], "multiple": True},
            {"key": "audience", "label": "本次计划访谈哪些目标人群？", "options": ["商户 / 店主", "消费者", "企业负责人", "行业专家", "园区 / 协会人员"], "multiple": True},
        ],
    },
    "enterprise": {
        "name": "企业访谈", "description": "通过对话，理解一家企业", "noun": "访谈",
        "steps": ["定义调研目标", "研究背景与方案", "访谈提纲", "开展访谈", "洞察分析", "研究成果"],
        "fields": [
            {"key": "industry", "label": "企业属于哪个行业？", "options": ["综合 / 暂不限定", "制造业", "消费零售", "互联网科技", "专业服务", "能源与环保"], "multiple": False},
            {"key": "goal", "label": "本次调研聚焦哪些业务问题？", "options": ["理解业务流程", "识别业务痛点", "验证需求假设", "业务与商业模式", "经营挑战", "组织与人才", "数字化转型", "发展战略"], "multiple": True},
            {"key": "audience", "label": "本次计划访谈哪些业务角色？", "options": ["创始人 / 企业家", "企业高管", "业务负责人", "一线员工", "合作伙伴"], "multiple": True},
        ],
    },
}


def _grounded_industries(state):
    """Current model label plus original-prompt keyword matches, most specific first."""
    prompt = state["prompt"]
    candidate = state.get("known_industry", "")
    candidates = [candidate] if isinstance(candidate, str) and 1 < len(candidate) <= 64 and candidate in prompt else []
    candidates += ["新能源汽车", "电动汽车", "汽车", "半导体", "消费电子", "餐饮", "制造业", "消费零售", "互联网科技", "文旅", "农业", "食品", "房地产", "医药", "教育", "金融", "便利店", "咖啡"]
    matches = []
    for value in sorted(set(candidates), key=lambda value: (-len(value), value)):
        for match in re.finditer(re.escape(value), prompt):
            prefix = prompt[max(0, match.start() - 8):match.start()]
            if not re.search(r"(?:不是|不做|不调研|不考虑|排除|不研究)[^，。；]*$", prefix):
                matches.append(value)
                break
    return matches


def known_industry(state):
    return next(iter(_grounded_industries(state)), "")


def intake_fields(state):
    fields = [dict(field) for field in SCENARIOS[state["scenario"]]["fields"]]
    industry = known_industry(state) if state.get("mode") == "ai" else ""
    for field in fields:
        field["allow_custom"] = field["key"] in {"industry", "goal", "audience"}
        if field["key"] == "industry" and industry:
            field["label"] = "调研行业 / 产品"
            field["resolved_value"] = industry
            field["options"] = list(dict.fromkeys([industry, *field["options"]]))
    return fields


def outline_questions(markdown):
    """Extract actual questions from the saved outline, never substitute examples."""
    # Prefer the actual interview section over research hypotheses in its intro.
    headings=list(re.finditer(r'^\s*(#{1,6})\s+(.+)$',markdown,re.M))
    sections=[]
    for index,heading in enumerate(headings):
        title=heading.group(2).replace('**','')
        if re.search(r'核心问题|访谈问题|采访问题|问题清单|提问清单',title) and '研究问题' not in title:
            end=next((item.start() for item in headings[index+1:] if len(item.group(1))<=len(heading.group(1))),len(markdown))
            sections.append(markdown[heading.end():end])
    if sections:markdown='\n'.join(sections)
    questions = []
    fenced=False
    for raw in markdown.splitlines():
        if raw.lstrip().startswith(('```','~~~')):
            fenced=not fenced
            continue
        if fenced:continue
        if raw.lstrip().startswith(("#", ">", "```")):
            continue
        text = re.sub(r"^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.、)）]\s*)", "", raw.replace('**','')).strip()
        if text and len(text) <= 200 and (re.search(r"[？?]", text) or re.match(r"^(请(?:介绍|谈|讲|描述|回忆)|能否|如何|为什么|是否)", text)) and text not in questions:
            questions.append(text)
    return questions[:80]
