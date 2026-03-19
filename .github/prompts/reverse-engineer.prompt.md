Act as an expert Software Engineer and Technical Analyst. 

I have attached the staged code / recent commits for a project that has just been developed. I need you to reverse-engineer the implementation and generate a highly detailed technical document named `doc-solution-logic.md`. 

Your PRIMARY GOAL is to extract and document the exact BUSINESS LOGIC, rules, and workflows implemented in this code. This document will be used for a strict gap analysis against our original business and technical specifications.

Please structure `doc-solution-logic.md` with the following sections, basing your analysis STRICTLY on the provided code:

1. **Implemented Business Workflows**: Provide a step-by-step breakdown of the core processes. How does data flow from input to output? Describe the exact sequence of operations.
2. **Business Rules & Conditional Logic**: This is the most important section. Detail every business rule found in the code. Extract the logic behind `if/else` statements, `switch` cases, and loops. (e.g., "If user status is X and balance > Y, the system triggers Z").
3. **Data Validation & Constraints**: What are the strict requirements for data to be processed? Detail any form validations, null checks, schema enforcements, or permission/authorization checks implemented.
4. **Calculations & Data Transformations**: Detail any specific algorithms, math formulas, string manipulations, or data mapping happening within the services/controllers. How is the raw data transformed before being saved or returned?
5. **Error Handling & Edge Cases**: Document how the code reacts to business rule violations. What specific errors, exceptions, or fallback mechanisms are triggered when the logic fails?
6. **Data Models & State**: Briefly describe the structural entities handled by this logic (e.g., database models or state objects) and how their status changes throughout the workflows.

CRITICAL INSTRUCTIONS: 
- Be extremely granular about the logic. Do not just say "It validates the user"; explain *exactly what* it validates about the user based on the code.
- Do not make assumptions, guess intent, or include planned features. Document ONLY the logic that is explicitly written and functioning in the provided code.