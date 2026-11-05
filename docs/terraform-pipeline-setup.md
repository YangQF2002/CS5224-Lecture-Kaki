# Terraform pipeline setup

One-time configuration for the [Terraform deploy workflow](../.github/workflows/terraform-deploy.yml), which deploys the `terraform-dev` environment. Two people are needed: an **AWS admin** (can create IAM roles and OIDC providers in the target account; the team uses `320465872576`) and a **GitHub repository admin**. The same steps work for a fork deploying to another account.

## How the pipeline signs in

GitHub Actions uses OIDC instead of stored AWS keys. On each run GitHub issues a short-lived token naming the repository and job; AWS exchanges it for about one hour of credentials for the deploy role `lecture-kaki-terraform-dev-github-deploy`. Nothing secret is stored in GitHub.

The role trusts only:

- jobs running on `main` of one repository, the team's by default (the automatic plan);
- jobs in the repository's `dev` environment (the approved apply).

GitHub names the repository by owner and repository ID as well as name (its "immutable subject"), for example `repo:YangQF2002@123465999/CS5224-Lecture-Kaki@1411985002`, so a deleted and recreated repository with the same name cannot inherit the trust.

It has `PowerUserAccess` plus IAM limited to roles and instance profiles named `lecture-kaki-terraform-dev-*`, and cannot change itself. It can still modify non-IAM resources anywhere in the account, so only this workflow should use it.

## 1. AWS admin

Run in bash from the repository root, signed in as the admin. The state bucket from [step 2 of the deployment guide](terraform-deployment.md#2-state-bucket-once-per-account) must exist.

```bash
aws login --profile <admin-profile> --region ap-southeast-1
export AWS_PROFILE=<admin-profile>
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
terraform -chdir=infra/terraform/github init -backend-config="bucket=lecturekaki-tfstate-$ACCOUNT_ID"
terraform -chdir=infra/terraform/github plan
```

If your terminal does not keep `export`ed values between commands, put the profile in front of each command instead, and type the bucket name in full:

```bash
AWS_PROFILE=<admin-profile> terraform -chdir=infra/terraform/github init -backend-config="bucket=lecturekaki-tfstate-<account>"
```

For a fork or any other repository, replace `OWNER/REPO` below with its name, print its subject prefix, and save it in a Git-ignored settings file before `plan`:

```bash
gh api repos/OWNER/REPO/actions/oidc/customization/sub --jq .sub_claim_prefix
echo 'github_subject_prefix = "PRINTED_VALUE"' > infra/terraform/github/terraform.tfvars
```

The plan's role trust rule should then show that value followed by `:ref:refs/heads/main` and `:environment:dev`. If the role already exists, the plan changes only its trust rule.

The plan should add 4 resources: the GitHub OIDC provider, the deploy role and its two permission attachments. If the account already trusts GitHub, `apply` fails with `EntityAlreadyExists` for the provider; rerun with `-var create_github_oidc_provider=false` (plan then adds 3).

```bash
terraform -chdir=infra/terraform/github apply
terraform -chdir=infra/terraform/github output -raw deploy_role_arn
```

Send the printed role ARN to the GitHub admin. The 27 resources in `infra/terraform/` do not need to be applied first; the pipeline's first run creates them.

## 2. GitHub repository admin

In the repository's **Settings**:

1. **Environments → New environment**, named `dev`. Under **Deployment protection rules**, tick **Required reviewers** and add who may approve deployments. Under **Deployment branches and tags**, choose **Selected branches and tags** and add `main`.
2. **Secrets and variables → Actions → Variables → New repository variable**, once for each:

   | Name                    | Value                                                                                                        |
   | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
   | `AWS_DEPLOY_ROLE_ARN`   | The role ARN from step 1                                                                                     |
   | `TF_STATE_BUCKET`       | `lecturekaki-tfstate-<account>`; the team's is `lecturekaki-tfstate-320465872576`                            |
   | `COGNITO_DOMAIN_PREFIX` | The sign-in page name; the team's is `lecture-kaki-terraform-dev`, other accounts need their own unique name |

   Or set them with the GitHub CLI:

   ```bash
   gh variable set AWS_DEPLOY_ROLE_ARN -R <owner>/<repo> --body "<role-arn>"
   gh variable set TF_STATE_BUCKET -R <owner>/<repo> --body "lecturekaki-tfstate-<account>"
   gh variable set COGNITO_DOMAIN_PREFIX -R <owner>/<repo> --body "<sign-in-name>"
   ```

## Running it

- **Every push to `main`** (including merged pull requests) runs **Plan**. The plan appears in the run's summary.
- **Apply and deploy frontend** then waits. A required reviewer opens the run, reads the plan and selects **Review deployments → Approve**. The job applies exactly that plan, waits for the API's `/health`, then builds and uploads the frontend.
- **Manual run:** Actions → **Terraform deploy** → **Run workflow** on `main`. Tick **Publish lecture data** for a first deployment or to refresh lectures. Runs from other branches are refused by AWS.
- An approval that comes after another change to the environment fails with a stale-plan error; run the workflow again.

## Notes

- The saved plan is passed between jobs as a workflow artifact kept for one day. In a public repository any signed-in GitHub user can download it. It currently holds only resource names and IDs; do not add secrets to the Terraform configuration without revisiting this.
- Pull requests do not use AWS. CI runs `terraform fmt -check` and `terraform validate` on every pull request.
- To stop deployments, delete the `AWS_DEPLOY_ROLE_ARN` variable or the `dev` environment. To remove AWS access entirely, run `terraform -chdir=infra/terraform/github destroy` as the AWS admin.
