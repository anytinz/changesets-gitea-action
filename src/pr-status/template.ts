import { getChangedPackagesSinceRef } from '@changesets/git'
import { humanId } from 'human-id'

export const getNewChangesetUrl = (
  headRepoUrl: string,
  headRef: string,
  templateContent: string,
): string => {
  const fileName = humanId({ separator: '-', capitalize: false })
  return `${headRepoUrl}/new/${headRef}?filename=.changeset/${fileName}.md&value=${encodeURIComponent(templateContent)}`
}

export const getNewChangesetTemplateContent = async (
  cwd: string,
  baseRef: string,
  prTitle: string,
): Promise<string> => {
  const changedPackages = await getChangedPackagesSinceRef({
    cwd,
    ref: baseRef,
  })

  return `\
---
${changedPackages.map((p) => `"${p.packageJson.name}": patch`).join('\n')}
---

${prTitle}
`
}
