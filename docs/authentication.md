# Authentication

Use Cognito for signup, email confirmation, and login, and Cognito access tokens to authenticate requests to FastAPI. Signup requires an `@u.nus.edu` address.

## How it works

```mermaid
sequenceDiagram
    participant B as Browser app
    participant C as Cognito
    participant L as Signup Lambda
    participant A as FastAPI

    opt Signup
        B->>C: Sign up on Cognito's page
        C->>L: Check email domain
        L-->>C: Allow valid @u.nus.edu address
        Note over B,C: User confirms email before login
    end

    B->>C: Sign in on Cognito's page
    C-->>B: Redirect back with authorisation code
    B->>C: Exchange code for tokens using PKCE
    C-->>B: Return tokens

    B->>A: Call API with access token
    A->>A: Validate token and identify user
    A-->>B: Feature response
```

1. **Sign up:** use an `@u.nus.edu` address and confirm the emailed code. The signup Lambda rejects other domains.
2. **Sign in:** use Cognito's hosted page. Cognito redirects to the app with a temporary authorisation code.
3. **Exchange code for tokens:** check `state` and exchange the code using S256 PKCE, which ties the exchange to the app that started login. No client secret is used.
4. **Access a feature that requires login:** e.g. posting a comment in the forum. Include the access token in the API request.

## Using authentication in features

- **Frontend:** use the region, pool ID, public client ID, and hosted domain from the stack outputs. Register exact callback/logout URLs and use HTTPS outside local development. Handle the login callback, token refresh, and logout; send API requests with `Authorization: Bearer <access_token>`.
- **Backend:** use `Depends(get_current_user)` from `app.auth` on protected routes. It validates the token's signature, expiry, issuer, app-client `client_id`, `token_use=access`, and non-empty `sub`. Use the returned `user_id` (the verified `sub`), rather than a caller-supplied ID.
- **Feature permissions:** check ownership separately where required. For example, take a comment's author from the authenticated user and allow edits only by its owner.

`GET /auth/me` returns `{"user_id": "<sub>"}`. Missing or invalid credentials return `401` with a Bearer challenge; missing configuration or unavailable signing keys return `503`. `GET /health` is public.

## Tokens and access

| Token         | Purpose                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| Access token  | Credential for protected API requests; expires after 15 minutes.           |
| ID token      | Identity information for the frontend; do not use it as an API credential. |
| Refresh token | Obtains new tokens from Cognito; expires after 30 days.                    |

- Email addresses cannot change after signup. Email confirmation proves mailbox access, not current NUS enrolment.
- On logout, clear local tokens, revoke the refresh token, and end the Cognito hosted session. Access tokens can still pass local validation until expiry.
- Keep passwords, tokens, confirmation codes, and AWS credentials out of logs and source control. Application integration uses public configuration, not AWS keys.

## Local configuration

From `backend/`, copy [`.env.example`](../backend/.env.example) to `.env.local` and fill in the public values from the deployment's stack outputs:

```dotenv
AWS_REGION=ap-southeast-1
COGNITO_USER_POOL_ID=<user-pool-id>
COGNITO_CLIENT_ID=<public-client-id>
COGNITO_DOMAIN=https://<domain-prefix>.auth.ap-southeast-1.amazoncognito.com
```

Start the API with `poetry run uvicorn app.main:app --reload --env-file .env.local`.

## Deployment

Deploy [infra/auth.yaml](../infra/auth.yaml) with AWS CLI v2 in `ap-southeast-1`. This creates the authentication resources; deploy the FastAPI application separately.

Configure an AWS profile with permissions for CloudFormation, S3, Cognito, Lambda, CloudWatch Logs, and IAM role creation/pass-role. Create a private S3 bucket in the same region with public access blocked to hold the Lambda deployment package.

### Package and review

Run from the repository root in PowerShell:

```powershell
$awsProfile = '<development-profile>'
$artifactBucket = '<private-artifact-bucket>'
$domainPrefix = '<unique-hosted-domain-prefix>'

aws sts get-caller-identity --profile $awsProfile
New-Item -ItemType Directory -Force build | Out-Null
aws cloudformation package --template-file infra/auth.yaml --s3-bucket $artifactBucket --s3-prefix lecture-kaki/auth --output-template-file build/auth.packaged.yaml --region ap-southeast-1 --profile $awsProfile
aws cloudformation validate-template --template-body file://build/auth.packaged.yaml --region ap-southeast-1 --profile $awsProfile
aws cloudformation deploy --template-file build/auth.packaged.yaml --stack-name lecture-kaki-auth-dev --parameter-overrides "DomainPrefix=$domainPrefix" --capabilities CAPABILITY_IAM --no-execute-changeset --region ap-southeast-1 --profile $awsProfile
```

Packaging uploads the Lambda. Deployment prepares a change set without applying it. Review it, especially any user-pool replacement:

```powershell
$changeSetArn = '<printed-change-set-arn>'
aws cloudformation describe-change-set --change-set-name $changeSetArn --region ap-southeast-1 --profile $awsProfile
```

Defaults are callback `http://localhost:8000/docs/oauth2-redirect` and logout destination `http://localhost:8000/docs`. Override `CallbackURLs` and `LogoutURLs` for a different client.

### Apply and verify

Execute the reviewed change set:

```powershell
aws cloudformation execute-change-set --change-set-name $changeSetArn --region ap-southeast-1 --profile $awsProfile
```

Wait for the stack to finish successfully, then read its public configuration:

```powershell
aws cloudformation describe-stacks --stack-name lecture-kaki-auth-dev --query 'Stacks[0].Outputs' --region ap-southeast-1 --profile $awsProfile
```

The user pool is retained on stack deletion/replacement; remove retained resources and S3 deployment packages when no longer needed. Lambda logs expire after 14 days. Default Cognito email delivery is limited to 50 messages per account per day; see [AWS email limits](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html).

## Testing against Cognito

Opt-in integration tests check real access-token identity, ID-token rejection, and the Lambda's rejection of ordinary and lookalike non-NUS domains. Normal tests and CI exclude these checks. If the domain gate fails, remove any created `lecture-kaki-test-` accounts.

Sign in to the deployed pool through local `/docs` using a designated NUS email account. From the browser's Network panel, copy both tokens from the same successful `/oauth2/token` response into `backend/.env.local`. Remove them after testing; never share them in issues or test output.

```dotenv
COGNITO_TEST_ACCESS_TOKEN=<fresh-access-token>
COGNITO_TEST_ID_TOKEN=<fresh-id-token-from-the-same-login>
```

From `backend/`, run:

```sh
poetry run python -m pytest -m cognito tests/integration
```

What to check:

- [ ] Email confirmation: login is blocked before confirmation and succeeds after entering the emailed code.
- [ ] Password recovery: the emailed recovery code allows a password reset, and login succeeds with the new password.
- [ ] Token refresh: a valid refresh token obtains new access tokens without another login.
- [ ] Refresh-token revocation: a revoked refresh token can no longer obtain new tokens.
- [ ] Hosted logout: signing out ends Cognito's browser session, and the next sign-in requires credentials.

References: [backend setup](../backend/README.md), [signup Lambda](../backend/lambdas/pre_signup/handler.py), [Cognito code and PKCE flow](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html), and [JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html).
