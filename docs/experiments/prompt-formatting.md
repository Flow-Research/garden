# Prompt formatting: XML vs markdown vs plain text

Status: **untested** — needs A/B eval across target models.

## Context

Garden assembles system prompts as pure markdown (## headers, `- label: value` lists, `\n\n` delimiters). No XML tags. Worth testing whether structured XML or a hybrid approach improves instruction adherence, section boundary respect, and long-context fidelity.

## Model-specific guidance (as of May 2026)

| Model family | Vendor recommendation | Notes |
|---|---|---|
| Claude 4.x | XML tags | Trained to recognize `<instructions>`, `<context>`, etc. Anthropic docs explicitly recommend XML for mixed-content prompts. |
| GPT 5.x | Markdown (headers, lists, backticks) | OpenAI recommends markdown-first. XML "also performs well," especially for long-context document scenarios. JSON discouraged. |
| Kimi K2.6 | Format-agnostic | Docs list XML, triple quotes, and section headings as interchangeable delimiters. Most detailed examples use XML. Default temp changed from 0.6 → 1.0 (old prompts need re-tuning). |

## Kimi K2.6 specifics

- 1T params, open-weight (Modified MIT), 256K context
- Ties GPT-5.5 on SWE-Bench Pro (58.6%), leads Humanity's Last Exam w/ tools (54.0%)
- Scales to 300 sub-agents, 4,000+ coordinated tool calls, 12h+ continuous execution
- Multimodal (text, image, video); thinking and non-thinking modes
- ~80% cheaper per token than comparable closed models
- Available on OpenRouter, Cloudflare Workers AI, HuggingFace

## What to test

1. **Baseline (current):** markdown-only prompts — measure instruction adherence, section bleed in long context, tool-call accuracy.
2. **XML-wrapped sections:** wrap each context provider output (`foundation`, `agent`, `workspace`, per-run context) in named XML tags. Measure same metrics.
3. **Hybrid:** markdown prose inside XML section boundaries — best-of-both hypothesis.
4. **Cross-model:** run identical prompts through Claude, Kimi K2.6, and GPT to find the format that degrades least across all three.

## Hypothesis

Markdown prose inside XML section boundaries is the sweet spot for multi-model compatibility. Pure markdown works but risks section bleed at long context lengths. Pure XML adds verbosity without proportional benefit for prose-heavy sections.

## Sources

- [Anthropic: Use XML tags to structure prompts](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags)
- [OpenAI: GPT-4.1 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)
- [Kimi: Prompt Best Practices](https://platform.kimi.ai/docs/guide/prompt-best-practice)
- [Kimi K2.6 Tech Blog](https://www.kimi.com/blog/kimi-k2-6)
- [Kimi K2.6 Model Page](https://www.kimi.com/ai-models/kimi-k2-6)
