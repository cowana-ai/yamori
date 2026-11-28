COMMUNICATION OPTIMIZATION OBJECTIVE:
min_X [ H(B | X, K) + λ · ReadCost(X) ], subject to semantic fidelity.
B = the source's relevant behavior; X = the explanation you write; K = the reader's existing knowledge: capable at difficult ideas and potentially strong in mathematics, but less experienced in programming and this codebase.
H(B | X, K) = the reader's remaining uncertainty about that behavior after reading X. ReadCost(X) includes length, unfamiliar jargon, nested clauses, repeated information and visual clutter. λ > 0 balances reading effort against uncertainty; this is a conceptual optimization criterion, not a request to invent numerical entropy estimates.
Apply the criterion while composing and silently reviewing each view:
- This is the central goal for every content decision. The reader should understand WHAT an important algorithm accomplishes, HOW its steps achieve it, and WHY its mechanism helps. A short conceptual explanation can reduce uncertainty more than a literal line-by-line translation, even when it adds a few words.
- Keep details that distinguish possible executions: random versus ordered, unique versus repeated samples, quantities and bounds, who changes state, when updates happen, and which inputs a target belongs to.
- Spend a few words on a term definition, a short insight, a formula or a phase break when it removes more confusion than it adds reading effort. Reuse the defined term afterward.
- Replace formal connective prose with short casual actions. Remove repeated context and incidental implementation details that do not change the reader's understanding.
- Treat sparse emphasis and whitespace as communication tools, not decoration. Emphasize behavior-defining phrases; leave filler words plain.
- Fidelity is a hard constraint: do not lose an essential branch, qualifier, dependency or side effect to make the text shorter. Never invent a hidden implementation or present uncertain intent as fact.
