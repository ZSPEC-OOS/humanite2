import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'

const H2 = 'mt-10 text-lg font-semibold text-gray-900 dark:text-gray-100'

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-950">
      <div className="flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 dark:text-gray-100 md:text-6xl">
              Privacy Policy
            </h1>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Last updated: September 27, 2026
            </p>
          </div>

          {/* Body */}
          <div className="mx-auto mt-10 max-w-2xl text-base leading-relaxed text-gray-700 dark:text-gray-300">
            <p>
              Humanite is built around a simple principle: your writing is yours. This Privacy
              Policy explains what information Humanite collects, how it is used, when it may be
              shared with service providers, and the choices you have over your data.
            </p>

            <h2 className={H2}>Information we collect</h2>
            <p className="mt-3">
              When you create an account, Humanite may collect information such as your email
              address, account identifier, account tier, region, and information necessary to
              authenticate and secure your account. Passwords are not stored in plain text.
            </p>
            <p className="mt-3">
              When you use Humanite, we may process text you submit, generated or rewritten text,
              your selected writing settings, and related processing information. If
              transformation history is enabled, your original text and resulting output may be
              saved to your account history.
            </p>
            <p className="mt-3">
              Humanite also collects limited operational information such as request counts, word
              and character counts, processing times, error information, model or provider
              information, feature usage, and similar technical data used to operate, secure, and
              improve the service.
            </p>
            <p className="mt-3">
              If you configure your own AI provider or AI-detection service, Humanite may store the
              provider configuration you choose to save, including API credentials. Sensitive API
              credentials are encrypted when stored and are not returned to the browser in their
              original form after being saved.
            </p>

            <h2 className={H2}>How your writing is used</h2>
            <p className="mt-3">
              Humanite uses submitted text only as necessary to provide the features you request,
              such as rewriting, analysis, quality checking, document processing, or AI-detection
              scanning.
            </p>
            <p className="mt-3">
              Humanite does not use your submitted text or generated output to train Humanite
              models. Humanite does not sell your writing or use it for advertising.
            </p>
            <p className="mt-3">
              Humanite may use aggregated or de-identified operational information to improve
              reliability, performance, safety, and product quality. This information is intended
              to exclude the actual text you submit and the generated content returned to you.
            </p>

            <h2 className={H2}>AI providers</h2>
            <p className="mt-3">
              To perform a rewrite or other AI-powered operation, Humanite may send the text
              necessary to complete your request to the AI model provider being used for that
              request.
            </p>
            <p className="mt-3">
              Humanite may support both Humanite-provided models and models configured by users. If
              you choose to connect your own AI provider or API key, information sent to that
              provider is also subject to that provider’s terms and privacy practices.
            </p>
            <p className="mt-3">
              Humanite does not intentionally provide your content to AI providers for
              model-training purposes. Provider-specific processing and retention practices may
              nevertheless be governed by the provider’s applicable API terms and configuration.
            </p>

            <h2 className={H2}>Transformation history</h2>
            <p className="mt-3">
              When transformation history is enabled, Humanite may save your submitted text and
              generated output so you can return to previous work.
            </p>
            <p className="mt-3">
              Saved transformation history is retained for up to 30 days unless you delete it
              sooner.
            </p>
            <p className="mt-3">You may delete individual history items at any time.</p>
            <p className="mt-3">
              You may also turn transformation history off. When history is disabled, Humanite will
              not save the submitted text or generated output to your account history. Text may
              still be processed temporarily as technically necessary to complete your request.
            </p>
            <p className="mt-3">
              Humanite should not retain raw text in operational job records longer than necessary
              for processing when history is disabled.
            </p>

            <h2 className={H2}>Logs and analytics</h2>
            <p className="mt-3">
              Humanite may collect operational and security information needed to maintain the
              service, diagnose failures, prevent abuse, enforce usage limits, and understand
              overall product performance.
            </p>
            <p className="mt-3">
              Humanite does not intentionally write raw submitted text or generated output to
              application logs.
            </p>
            <p className="mt-3">
              Operational and security logs are generally retained for up to 90 days, unless a
              longer period is reasonably necessary for security, fraud prevention, legal
              compliance, or investigation of an active incident.
            </p>
            <p className="mt-3">
              Humanite may use third-party analytics or infrastructure services to understand how
              the service is used. If additional analytics services are introduced, this Privacy
              Policy may be updated to reflect material changes in how personal information is
              processed.
            </p>

            <h2 className={H2}>Cookies and local storage</h2>
            <p className="mt-3">
              Humanite uses technologies necessary to operate the service, maintain security,
              support authentication, and remember essential application preferences.
            </p>
            <p className="mt-3">
              At launch, Humanite does not use personal information for targeted advertising and
              does not use non-essential advertising cookies.
            </p>
            <p className="mt-3">
              Certain non-sensitive application settings or masked configuration information may be
              stored locally in your browser. Raw saved API credentials are not intended to be
              stored in browser local storage.
            </p>

            <h2 className={H2}>Payments</h2>
            <p className="mt-3">
              Payments and subscriptions may be processed by Stripe. Payment-card information is
              handled by Stripe rather than directly by Humanite.
            </p>
            <p className="mt-3">
              Humanite may receive and retain billing or subscription information needed to operate
              your account, confirm purchases, handle disputes, prevent fraud, and meet accounting,
              tax, or legal obligations.
            </p>
            <p className="mt-3">
              Billing and transaction records may be retained after account deletion where
              retention is required or reasonably necessary for those purposes.
            </p>

            <h2 className={H2}>Service providers</h2>
            <p className="mt-3">
              Humanite relies on service providers to operate parts of the service. Depending on
              the features you use, these may include:
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Google/Firebase for application data and infrastructure</li>
              <li>Cloudflare R2 for encrypted configuration storage</li>
              <li>Stripe for payments</li>
              <li>GPTZero for AI-detection functionality</li>
              <li>AI model providers used to process writing requests</li>
            </ul>
            <p className="mt-3">
              These providers receive only the information reasonably necessary to perform the
              services for which they are used, subject to their respective agreements and privacy
              practices.
            </p>

            <h2 className={H2}>API keys and provider credentials</h2>
            <p className="mt-3">
              If you save your own provider credentials in Humanite, sensitive API credentials are
              encrypted when stored.
            </p>
            <p className="mt-3">
              When you delete your Humanite account, stored API credentials and associated provider
              configuration are intended to be deleted immediately from Humanite’s active systems.
            </p>
            <p className="mt-3">
              If you use your own provider credentials, your relationship with that provider and
              its privacy practices may also apply to requests processed using those credentials.
            </p>

            <h2 className={H2}>Data retention</h2>
            <p className="mt-3">
              Humanite retains personal information only for as long as reasonably necessary for
              the purposes described in this policy.
            </p>
            <p className="mt-3">
              Transformation history is retained for up to 30 days unless deleted sooner.
              Operational and security logs are generally retained for up to 90 days. Account
              information is retained while your account remains active.
            </p>
            <p className="mt-3">
              When you delete your account, Humanite deletes the account and associated stored user
              content and configuration, subject to limited information that may need to be
              retained for legal, accounting, fraud-prevention, security, dispute-resolution, or
              similar legitimate purposes.
            </p>

            <h2 className={H2}>Your choices and privacy rights</h2>
            <p className="mt-3">
              Depending on where you live, you may have rights relating to your personal
              information, including rights to access, correct, export, or delete information and
              to object to or restrict certain processing.
            </p>
            <p className="mt-3">
              Humanite is designed to allow supported account information to be updated in the app.
              You may delete individual transformation-history items, disable history, export your
              stored information, or delete your account.
            </p>
            <p className="mt-3">
              You may also contact Humanite’s general support channel with privacy questions or
              requests that cannot be completed directly in the app.
            </p>
            <p className="mt-3">
              Humanite does not sell personal information and does not share personal information
              for targeted advertising.
            </p>
            <p className="mt-3">
              Where applicable, you may also have the right to submit a complaint to your local
              data-protection authority.
            </p>

            <h2 className={H2}>Email communications</h2>
            <p className="mt-3">You may opt out of promotional or marketing communications.</p>
            <p className="mt-3">
              Humanite may still send service-related communications that are necessary to operate
              your account, such as security, authentication, billing, policy, or important service
              notices.
            </p>

            <h2 className={H2}>Security</h2>
            <p className="mt-3">
              Humanite uses technical and organizational measures intended to protect user
              information. Depending on the type of information, these measures include password
              hashing, encryption of stored sensitive provider credentials, authentication
              controls, restricted access, and other security safeguards.
            </p>
            <p className="mt-3">
              Access to stored user content is restricted by default and should be limited to
              authorized personnel when reasonably necessary for service operation, support,
              security, abuse prevention, or legal compliance.
            </p>
            <p className="mt-3">No online service can guarantee absolute security.</p>

            <h2 className={H2}>Automated decision-making</h2>
            <p className="mt-3">
              Humanite does not use automated decision-making to make decisions about users that
              produce legal or similarly significant effects, such as decisions concerning
              employment, credit, insurance, or eligibility.
            </p>
            <p className="mt-3">
              Features that analyze or classify writing are tools for the user and are not intended
              to make such decisions about the user.
            </p>

            <h2 className={H2}>International processing</h2>
            <p className="mt-3">
              Humanite and its service providers may process information in the United States and
              other countries where they operate.
            </p>
            <p className="mt-3">
              Where required by applicable law, appropriate safeguards are used for transfers of
              personal information between jurisdictions.
            </p>

            <h2 className={H2}>Children</h2>
            <p className="mt-3">
              Humanite is not intended for children under 13 years of age, and Humanite does not
              knowingly collect personal information from children under 13.
            </p>
            <p className="mt-3">
              If Humanite learns that personal information from a child under 13 has been
              collected, appropriate steps will be taken to delete it.
            </p>

            <h2 className={H2}>Account deletion</h2>
            <p className="mt-3">You may delete your Humanite account through the application.</p>
            <p className="mt-3">
              Account deletion is intended to remove your account, saved transformation history,
              presets, stored provider configuration, and other associated user data from
              Humanite’s active systems.
            </p>
            <p className="mt-3">
              Stored API credentials should be deleted immediately as part of this process. Limited
              records may remain where legally required or reasonably necessary for billing, tax,
              fraud prevention, security, dispute resolution, or similar obligations.
            </p>

            <h2 className={H2}>Changes to this policy</h2>
            <p className="mt-3">
              Humanite may update this Privacy Policy as the product, service providers, or legal
              requirements change.
            </p>
            <p className="mt-3">
              If a change materially affects how personal information is handled, Humanite will
              provide appropriate notice through the service or another reasonable method.
            </p>

            <h2 className={H2}>Contact</h2>
            <p className="mt-3">
              For privacy questions, data requests, or concerns, contact Humanite through its
              general support channel.
            </p>
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}
