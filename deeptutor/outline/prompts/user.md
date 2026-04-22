Please generate a knowledge-point outline based on the following requirement.

---

## User Requirement

{{requirement}}

---

## Output Requirements

Automatically infer the following from the requirement text:

- Course topic and core content
- Target audience and difficulty level
- Course duration (default 15-30 minutes if not specified)
- Teaching style (formal / casual / interactive / academic)

Then output a single JSON object with `courseTitle`, `courseDescription`, `languageDirective`, and `outlines`. Each entry in the `outlines` array must include:

```json
{
  "id": "kp_1",
  "order": 1,
  "title": "Knowledge point title",
  "description": "1-2 sentences on teaching purpose",
  "keyPoints": ["Requirement 1", "Requirement 2", "Requirement 3"],
  "teachingObjective": "Learner-facing objective",
  "estimatedDuration": 300
}
```

### Notes

1. **Knowledge-point count**: Match the count to the topic's natural breadth. Simple topics may need 3-5; deep topics may need 15-25. Do NOT pad.
2. **Flat list only**: Do not group into chapters or add nested structure.
3. **IDs must be sequential** (`kp_1`, `kp_2`, ...) and match `order`.
4. **Language**: Infer from the user's requirement text and context, then output all content in the inferred teaching language.

Output the JSON object directly, with no prose and no markdown code fences.
