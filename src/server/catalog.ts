import type { Catalog, CreateSessionRequest } from "@/shared/contracts";
import { AppError } from "./errors";
import { companyGuides } from "@/shared/company-guides";
const companies = companyGuides.map(({ id, name }) => ({ id, name }));
const roles = [{ id: "software-engineer", name: "Software Engineer" }];
const interviewModes = [
  "behavioral",
  "technical",
  "system_design",
  "mixed",
] as const;
export const catalog: Catalog = {
  companies,
  roles,
  interviewModes: [...interviewModes],
  availableInterviews: companies.flatMap((c) =>
    roles.flatMap((r) =>
      interviewModes.map((round) => ({ companyId: c.id, roleId: r.id, round })),
    ),
  ),
};
export function validateCombination(input: CreateSessionRequest) {
  if (
    !catalog.availableInterviews.some(
      (c) =>
        c.companyId === input.companyId &&
        c.roleId === input.roleId &&
        c.round === input.round,
    )
  )
    throw new AppError(
      "UNSUPPORTED_INTERVIEW",
      400,
      "Select a supported company, role, and interview mode.",
    );
}
