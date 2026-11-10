// Moves the issues a PR closes to a column on a GitHub Project board.
// Env: GH_TOKEN (token with project access), OWNER, REPO, PR_NUMBER, STATUS, PROJECT_NUMBER, STATUS_FIELD.
const { GH_TOKEN, OWNER, REPO, PR_NUMBER, STATUS, PROJECT_NUMBER, STATUS_FIELD = "Status" } = process.env

async function graphql(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${GH_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json()
  if (!response.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body))
  return body.data
}

const issues = (
  await graphql(
    `query ($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) { closingIssuesReferences(first: 20) { nodes { number } } }
      }
    }`,
    { owner: OWNER, repo: REPO, pr: Number(PR_NUMBER) },
  )
).repository.pullRequest.closingIssuesReferences.nodes.map((node) => node.number)

if (!issues.length) {
  console.info("no linked issues, nothing to move")
  process.exit(0)
}

const project = (
  await graphql(
    `query ($owner: String!, $number: Int!) {
      repositoryOwner(login: $owner) {
        ... on ProjectV2Owner {
          projectV2(number: $number) {
            id
            field(name: "${STATUS_FIELD}") { ... on ProjectV2SingleSelectField { id options { id name } } }
          }
        }
      }
    }`,
    { owner: OWNER, number: Number(PROJECT_NUMBER) },
  )
).repositoryOwner.projectV2

const option = project?.field?.options?.find((candidate) => candidate.name.toLowerCase() === STATUS.toLowerCase())
if (!option) {
  console.info(`::warning::no "${STATUS}" option on the "${STATUS_FIELD}" field of project ${PROJECT_NUMBER}`)
  process.exit(0)
}

for (const number of issues) {
  const item = (
    await graphql(
      `query ($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) { projectItems(first: 20) { nodes { id project { id } } } }
        }
      }`,
      { owner: OWNER, repo: REPO, number },
    )
  ).repository.issue.projectItems.nodes.find((node) => node.project.id === project.id)
  if (!item) {
    console.info(`#${number} is not on project ${PROJECT_NUMBER}, skipped`)
    continue
  }
  await graphql(
    `mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(
        input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }
      ) { projectV2Item { id } }
    }`,
    { project: project.id, item: item.id, field: project.field.id, option: option.id },
  )
  console.info(`#${number} -> ${option.name}`)
}
