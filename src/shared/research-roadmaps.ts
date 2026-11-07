export const researchRoadmaps = [
  {
    id: "agents",
    number: "01",
    title: "Agents that can act safely",
    category: "Agentic AI",
    skills: ["Tool use", "Permissions", "Evaluation"],
    rationale:
      "As models take actions through tools, engineering interviews could explore how you bound autonomy, recover from failures and measure task success.",
    steps: [
      {
        title: "Understand the loop",
        detail:
          "Trace how reasoning, tool calls and observations change an agent's next action.",
      },
      {
        title: "Design the boundaries",
        detail:
          "Plan least-privilege tools, approval points, idempotency and recovery from partial failures.",
      },
      {
        title: "Evaluate end to end",
        detail:
          "Create a task suite that measures successful outcomes, unsafe actions, cost and latency.",
      },
    ],
    question:
      "An AI support agent can issue refunds. How would you constrain its permissions and recover safely when a tool times out?",
    source: {
      title: "ReAct",
      date: "Oct 2022",
      url: "https://arxiv.org/abs/2210.03629",
    },
  },
  {
    id: "retrieval",
    number: "02",
    title: "Reliable, grounded AI products",
    category: "Retrieval & evaluation",
    skills: ["RAG", "Data freshness", "Grounding"],
    rationale:
      "AI products need answers grounded in changing information. A future design discussion could test retrieval quality, access control and evaluation beyond a convincing demo.",
    steps: [
      {
        title: "Build the foundation",
        detail:
          "Understand embeddings, chunking, indexing and the difference between retrieval and generation failures.",
      },
      {
        title: "Make it dependable",
        detail:
          "Design document permissions, freshness checks, citations and abstention when evidence is missing.",
      },
      {
        title: "Prove it works",
        detail:
          "Separate retrieval metrics from answer faithfulness; test stale, missing and contradictory evidence.",
      },
    ],
    question:
      "Design an internal knowledge assistant. How would you keep answers current and prevent it from revealing documents a user cannot access?",
    source: {
      title: "Retrieval-Augmented Generation",
      date: "May 2020",
      url: "https://arxiv.org/abs/2005.11401",
    },
  },
  {
    id: "inference",
    number: "03",
    title: "AI infrastructure under pressure",
    category: "Efficient inference",
    skills: ["KV cache", "Batching", "Capacity planning"],
    rationale:
      "Serving models introduces memory, throughput and latency trade-offs. Systems interviews could ask you to reason about these constraints alongside traditional scaling concerns.",
    steps: [
      {
        title: "Learn the bottlenecks",
        detail:
          "Explain prefill, decoding and why the KV cache consumes memory as context and concurrency grow.",
      },
      {
        title: "Compare the trade-offs",
        detail:
          "Explore paged memory, batching and admission control under a fixed GPU budget.",
      },
      {
        title: "Design for real traffic",
        detail:
          "Propose a load test measuring time to first token, tail latency, throughput and cost per request.",
      },
    ],
    question:
      "Your model-serving service runs out of GPU memory during traffic spikes. How would you improve concurrency while meeting a tail-latency target?",
    source: {
      title: "PagedAttention / vLLM",
      date: "Sep 2023",
      url: "https://arxiv.org/abs/2309.06180",
    },
  },
];
