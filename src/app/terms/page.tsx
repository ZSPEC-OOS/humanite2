import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'

const H2 = 'mt-10 text-lg font-semibold text-gray-900 dark:text-gray-100'
const UL = 'mt-3 list-disc space-y-1.5 pl-5'
const PRIVACY_LINK_CLASS = 'font-medium text-gray-900 underline underline-offset-2 dark:text-gray-100'

function PrivacyPolicyLink() {
  return (
    <Link href="/privacy" className={PRIVACY_LINK_CLASS}>
      Privacy Policy
    </Link>
  )
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-950">
      <div className="flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 dark:text-gray-100 md:text-6xl">
              Terms of Service
            </h1>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Last updated: September 27, 2026
            </p>
          </div>

          {/* Body */}
          <div className="mx-auto mt-10 max-w-2xl text-base leading-relaxed text-gray-700 dark:text-gray-300">
            <p>
              Welcome to Humanite. These Terms of Service (“Terms”) govern your access to and use
              of Humanite’s website, applications, AI-powered writing tools, detection features,
              and related services.
            </p>
            <p className="mt-3">
              By creating an account or using Humanite, you agree to these Terms. If you do not
              agree, do not use the service.
            </p>

            <h2 className={H2}>1. What Humanite provides</h2>
            <p className="mt-3">
              Humanite provides tools for transforming, revising, analyzing, and working with
              written content.
            </p>
            <p className="mt-3">Features may include:</p>
            <ul className={UL}>
              <li>AI-assisted rewriting</li>
              <li>tone, domain, and intensity controls</li>
              <li>fact and meaning preservation checks</li>
              <li>document consistency tools</li>
              <li>AI-detection analysis</li>
              <li>transformation history</li>
              <li>document export</li>
              <li>user-configured AI providers and API credentials</li>
              <li>other writing and analysis features introduced over time</li>
            </ul>
            <p className="mt-3">
              Humanite may change, improve, add, or remove features as the service evolves.
            </p>

            <h2 className={H2}>2. Eligibility</h2>
            <p className="mt-3">You must be at least 13 years old to use Humanite.</p>
            <p className="mt-3">
              If the law where you live requires a higher minimum age for you to enter into these
              Terms or use an online service without parental consent, that higher age requirement
              applies.
            </p>
            <p className="mt-3">
              You may not use Humanite if you are prohibited from doing so under applicable law.
            </p>

            <h2 className={H2}>3. Your account</h2>
            <p className="mt-3">Some Humanite features require an account.</p>
            <p className="mt-3">You are responsible for:</p>
            <ul className={UL}>
              <li>providing accurate account information</li>
              <li>maintaining the security of your credentials</li>
              <li>keeping your account information reasonably current</li>
              <li>activities performed through your account</li>
              <li>notifying Humanite if you believe your account has been compromised</li>
            </ul>
            <p className="mt-3">
              You may not share credentials in a way that circumvents account, usage, or
              subscription restrictions.
            </p>
            <p className="mt-3">
              Humanite may take reasonable steps to protect accounts from unauthorized access,
              abuse, fraud, or security threats.
            </p>

            <h2 className={H2}>4. Your content</h2>
            <p className="mt-3">
              You retain ownership of the text, documents, and other content you submit to
              Humanite.
            </p>
            <p className="mt-3">
              You also retain any rights you may have in the output generated for you, subject to
              applicable law and any rights that may exist in underlying third-party material.
            </p>
            <p className="mt-3">You grant Humanite a limited right to process your content only as reasonably necessary to:</p>
            <ul className={UL}>
              <li>provide the service you request</li>
              <li>generate and return results</li>
              <li>perform quality and fidelity checks</li>
              <li>provide requested AI-detection analysis</li>
              <li>maintain optional account history</li>
              <li>secure and operate the service</li>
              <li>comply with applicable law</li>
            </ul>
            <p className="mt-3">This permission does not transfer ownership of your writing to Humanite.</p>
            <p className="mt-3">
              Humanite does not use your submitted writing or generated output to train Humanite
              models.
            </p>
            <p className="mt-3">
              Additional information about how content is handled is described in the{' '}
              <PrivacyPolicyLink />.
            </p>

            <h2 className={H2}>5. You are responsible for what you submit</h2>
            <p className="mt-3">
              You must have the necessary rights or permission to submit content to Humanite.
            </p>
            <p className="mt-3">Do not submit content when doing so would:</p>
            <ul className={UL}>
              <li>violate another person’s intellectual-property rights</li>
              <li>violate confidentiality obligations</li>
              <li>unlawfully disclose personal or sensitive information</li>
              <li>violate applicable law</li>
              <li>facilitate fraud, impersonation, or other unlawful conduct</li>
            </ul>
            <p className="mt-3">
              Humanite does not acquire rights to third-party content simply because a user
              submits it to the service.
            </p>

            <h2 className={H2}>6. Responsible use</h2>
            <p className="mt-3">
              You may use Humanite for legitimate writing, editing, research, communication, and
              other lawful purposes.
            </p>
            <p className="mt-3">You may not use Humanite to:</p>
            <ul className={UL}>
              <li>violate applicable laws or regulations</li>
              <li>defraud or deliberately deceive others</li>
              <li>impersonate another person without authorization</li>
              <li>distribute malware or malicious code</li>
              <li>interfere with or disrupt Humanite’s systems</li>
              <li>attempt to gain unauthorized access to accounts, infrastructure, or data</li>
              <li>circumvent technical restrictions, security mechanisms, rate limits, or usage limits</li>
              <li>use automated means to abuse or overload the service</li>
              <li>infringe intellectual-property or privacy rights</li>
              <li>facilitate academic misconduct or violate rules that apply to your school, employer, publication, professional body, or other institution</li>
              <li>falsely represent AI-generated or AI-assisted work as entirely unaided human work when disclosure is required by law, policy, contract, or applicable rules</li>
            </ul>
            <p className="mt-3">
              Humanite is a writing tool. It does not override the rules or disclosure
              requirements that apply to you.
            </p>

            <h2 className={H2}>7. AI-generated and transformed content</h2>
            <p className="mt-3">AI systems can make mistakes.</p>
            <p className="mt-3">
              Humanite is designed to reduce unwanted changes and may perform checks intended to
              preserve facts, meaning, terminology, numbers, relationships, and other important
              information. These systems are not perfect.
            </p>
            <p className="mt-3">
              You are responsible for reviewing output before relying on, publishing, submitting,
              or distributing it.
            </p>
            <p className="mt-3">Humanite does not guarantee that output will always be:</p>
            <ul className={UL}>
              <li>factually correct</li>
              <li>complete</li>
              <li>error-free</li>
              <li>appropriate for a particular purpose</li>
              <li>identical in meaning to the original</li>
              <li>free from unintended changes</li>
            </ul>
            <p className="mt-3">
              For important professional, academic, medical, legal, financial, technical, or
              safety-related material, you should independently review the final text and obtain
              appropriate professional review when necessary.
            </p>

            <h2 className={H2}>8. AI detection</h2>
            <p className="mt-3">
              Humanite may provide tools that estimate whether text exhibits characteristics
              associated with AI-generated writing.
            </p>
            <p className="mt-3">
              AI-detection systems are probabilistic and may produce false positives, false
              negatives, or inconsistent results.
            </p>
            <p className="mt-3">A detection score or classification:</p>
            <ul className={UL}>
              <li>is not proof of authorship</li>
              <li>does not establish whether a person did or did not use AI</li>
              <li>should not be treated as a definitive factual determination</li>
              <li>may vary between providers, text lengths, writing styles, and model versions</li>
            </ul>
            <p className="mt-3">
              Humanite does not guarantee that text will receive any particular classification
              from Humanite or a third-party detector.
            </p>
            <p className="mt-3">Humanite does not guarantee that rewritten text will be “undetectable.”</p>

            <h2 className={H2}>9. Your own AI provider and API keys</h2>
            <p className="mt-3">
              Humanite may allow you to connect supported third-party AI providers using your own
              API credentials.
            </p>
            <p className="mt-3">If you choose to do so:</p>
            <ul className={UL}>
              <li>you are responsible for your relationship with that provider</li>
              <li>the provider’s terms, pricing, usage limits, and privacy practices may apply</li>
              <li>charges imposed by that provider are your responsibility</li>
              <li>Humanite does not control the provider’s availability or policies</li>
              <li>the provider may change or discontinue its API independently of Humanite</li>
            </ul>
            <p className="mt-3">
              Humanite may restrict provider endpoints or configurations for security reasons.
            </p>
            <p className="mt-3">
              Stored provider credentials are handled according to Humanite’s{' '}
              <PrivacyPolicyLink /> and security practices.
            </p>
            <p className="mt-3">You should not provide credentials you are not authorized to use.</p>

            <h2 className={H2}>10. Third-party services</h2>
            <p className="mt-3">Humanite relies on third-party services to provide portions of the service.</p>
            <p className="mt-3">
              Depending on the functionality you use, these may include infrastructure providers,
              payment processors, AI model providers, storage providers, and AI-detection
              services.
            </p>
            <p className="mt-3">Examples currently used or supported by Humanite may include:</p>
            <ul className={UL}>
              <li>Google/Firebase</li>
              <li>Cloudflare</li>
              <li>Stripe</li>
              <li>GPTZero</li>
              <li>supported AI model providers</li>
            </ul>
            <p className="mt-3">
              Humanite does not control third-party services and is not responsible for changes,
              interruptions, errors, or policies originating from those providers.
            </p>
            <p className="mt-3">Your use of a third-party service may also be subject to that provider’s terms.</p>

            <h2 className={H2}>11. Payments and subscriptions</h2>
            <p className="mt-3">Humanite may offer free and paid service tiers.</p>
            <p className="mt-3">
              Prices, included features, usage allowances, billing intervals, and other plan
              details are displayed on the applicable pricing or checkout page.
            </p>
            <p className="mt-3">
              Paid transactions may be processed through Stripe or another disclosed payment
              provider.
            </p>
            <p className="mt-3">
              By purchasing a paid plan, you authorize the applicable payment provider to charge
              the payment method you supply according to the terms presented at checkout.
            </p>
            <p className="mt-3">Taxes may apply depending on your location.</p>
            <p className="mt-3">
              Humanite may change future pricing or plan features. Changes that affect an existing
              paid subscription will be handled in accordance with applicable law and any notice
              requirements that apply.
            </p>
            <p className="mt-3">
              Any cancellation or refund rights required by applicable law remain unaffected.
            </p>
            <p className="mt-3">
              Humanite should not be interpreted as offering a refund policy beyond what is
              expressly displayed at purchase or required by law.
            </p>

            <h2 className={H2}>12. Usage limits</h2>
            <p className="mt-3">
              Humanite may apply reasonable limits to requests, word counts, processing volume,
              detection scans, storage, or other resource-intensive features.
            </p>
            <p className="mt-3">Limits may vary by plan.</p>
            <p className="mt-3">Humanite may enforce limits intended to:</p>
            <ul className={UL}>
              <li>protect service reliability</li>
              <li>prevent abuse</li>
              <li>control infrastructure costs</li>
              <li>maintain fair access</li>
              <li>protect third-party API capacity</li>
            </ul>
            <p className="mt-3">
              Attempting to circumvent these limits may result in restrictions or suspension.
            </p>

            <h2 className={H2}>13. Transformation history and stored content</h2>
            <p className="mt-3">Humanite may offer optional transformation history.</p>
            <p className="mt-3">
              When enabled, transformation history may store submitted and generated text for the
              retention period described in the <PrivacyPolicyLink />.
            </p>
            <p className="mt-3">
              You may be able to delete individual history items or disable history entirely.
            </p>
            <p className="mt-3">
              If history is disabled, Humanite may still temporarily process content as necessary
              to complete the requested operation.
            </p>
            <p className="mt-3">
              The <PrivacyPolicyLink /> governs retention and deletion practices.
            </p>

            <h2 className={H2}>14. Intellectual property</h2>
            <p className="mt-3">
              Humanite, including its software, interface, branding, logos, designs,
              documentation, and other proprietary materials, is owned by Humanite or its
              licensors and is protected by applicable intellectual-property laws.
            </p>
            <p className="mt-3">
              These Terms give you permission to use the service. They do not transfer ownership
              of Humanite itself.
            </p>
            <p className="mt-3">You may not, except where permitted by law:</p>
            <ul className={UL}>
              <li>copy or redistribute Humanite’s proprietary software</li>
              <li>remove proprietary notices</li>
              <li>sell or sublicense access to the service without authorization</li>
              <li>reverse engineer protected portions of the service</li>
              <li>use Humanite branding in a way that falsely implies sponsorship or endorsement</li>
            </ul>
            <p className="mt-3">
              Nothing in this section limits rights granted by applicable open-source licenses for
              software that Humanite may make available under those licenses.
            </p>

            <h2 className={H2}>15. Feedback</h2>
            <p className="mt-3">
              If you voluntarily provide feedback, ideas, or suggestions about Humanite, you permit
              Humanite to use that feedback to develop and improve the service without an
              obligation to compensate you.
            </p>
            <p className="mt-3">
              This does not give Humanite ownership of your private documents or writing.
            </p>

            <h2 className={H2}>16. Service availability</h2>
            <p className="mt-3">
              Humanite aims to provide a reliable service, but continuous availability is not
              guaranteed.
            </p>
            <p className="mt-3">The service may occasionally be unavailable due to:</p>
            <ul className={UL}>
              <li>maintenance</li>
              <li>software updates</li>
              <li>infrastructure failures</li>
              <li>third-party provider outages</li>
              <li>capacity limitations</li>
              <li>security incidents</li>
              <li>circumstances outside Humanite’s reasonable control</li>
            </ul>
            <p className="mt-3">
              Unless a separate written agreement expressly provides otherwise, Humanite does not
              provide a guaranteed uptime or service-level commitment.
            </p>

            <h2 className={H2}>17. Changes to the service</h2>
            <p className="mt-3">Humanite is an evolving product.</p>
            <p className="mt-3">
              Features, models, providers, interfaces, usage limits, and technical functionality
              may change over time.
            </p>
            <p className="mt-3">
              Humanite may modify or discontinue functionality where reasonably necessary,
              including for security, technical, legal, financial, or product reasons.
            </p>
            <p className="mt-3">
              Where a change materially affects a paid service or users’ legal rights, Humanite
              will provide notice when required by applicable law.
            </p>

            <h2 className={H2}>18. Suspension and termination</h2>
            <p className="mt-3">
              Humanite may restrict, suspend, or terminate access when reasonably necessary
              because of:
            </p>
            <ul className={UL}>
              <li>material violation of these Terms</li>
              <li>unlawful activity</li>
              <li>fraud or abuse</li>
              <li>threats to the service or other users</li>
              <li>attempts to defeat security or usage controls</li>
              <li>legal requirements</li>
              <li>nonpayment of applicable charges</li>
            </ul>
            <p className="mt-3">
              Where appropriate, Humanite may provide notice or an opportunity to correct the
              issue before termination.
            </p>
            <p className="mt-3">Serious security, fraud, or legal issues may require immediate action.</p>
            <p className="mt-3">
              You may stop using Humanite at any time and may delete your account as described in
              the application and <PrivacyPolicyLink />.
            </p>

            <h2 className={H2}>19. Privacy and account deletion</h2>
            <p className="mt-3">
              Humanite’s <PrivacyPolicyLink /> explains how personal information and user content
              are handled.
            </p>
            <p className="mt-3">
              Subject to limited information that may need to be retained for legitimate legal,
              billing, tax, accounting, fraud-prevention, security, or dispute-resolution purposes,
              account deletion is intended to remove associated user data as described in the{' '}
              <PrivacyPolicyLink />.
            </p>

            <h2 className={H2}>20. No professional advice</h2>
            <p className="mt-3">Humanite provides writing and text-analysis tools.</p>
            <p className="mt-3">Humanite is not a substitute for professional:</p>
            <ul className={UL}>
              <li>legal advice</li>
              <li>medical advice</li>
              <li>financial advice</li>
              <li>tax advice</li>
              <li>regulatory advice</li>
            </ul>
            <p className="mt-3">
              Output concerning specialized subjects should be independently reviewed by a
              qualified professional when appropriate.
            </p>

            <h2 className={H2}>21. Disclaimer of warranties</h2>
            <p className="mt-3">
              To the extent permitted by law, Humanite is provided on an “as is” and “as available”
              basis.
            </p>
            <p className="mt-3">Humanite does not guarantee that:</p>
            <ul className={UL}>
              <li>the service will always be available or uninterrupted</li>
              <li>every output will be accurate or complete</li>
              <li>every transformation will preserve every fact</li>
              <li>every third-party provider will remain available</li>
              <li>detection results will be accurate</li>
              <li>Humanite will satisfy every user’s particular requirements</li>
            </ul>
            <p className="mt-3">
              Nothing in these Terms excludes warranties or rights that cannot legally be excluded.
            </p>

            <h2 className={H2}>22. Limitation of liability</h2>
            <p className="mt-3">
              To the extent permitted by applicable law, Humanite will not be liable for indirect,
              incidental, special, consequential, exemplary, or punitive damages arising from use
              of the service.
            </p>
            <p className="mt-3">This may include losses resulting from:</p>
            <ul className={UL}>
              <li>reliance on generated content</li>
              <li>inaccurate or incomplete output</li>
              <li>detection classifications</li>
              <li>third-party provider failures</li>
              <li>loss of data</li>
              <li>service interruptions</li>
              <li>unauthorized use caused by failure to secure account credentials</li>
            </ul>
            <p className="mt-3">
              Any limitation of liability will apply only to the extent permitted by applicable
              law.
            </p>
            <p className="mt-3">
              Nothing in these Terms limits liability that cannot legally be limited or excluded.
            </p>

            <h2 className={H2}>23. Indemnification</h2>
            <p className="mt-3">
              To the extent permitted by applicable law, you agree to be responsible for claims,
              losses, or expenses arising from your unlawful use of Humanite, your violation of
              these Terms, or content you submit in violation of another person’s rights.
            </p>
            <p className="mt-3">This provision does not apply where prohibited by applicable law.</p>

            <h2 className={H2}>24. Changes to these Terms</h2>
            <p className="mt-3">
              Humanite may update these Terms as the service or applicable legal requirements
              change.
            </p>
            <p className="mt-3">
              If changes materially affect your rights or obligations, Humanite will provide
              reasonable notice where required.
            </p>
            <p className="mt-3">
              Continued use of Humanite after updated Terms become effective constitutes
              acceptance where permitted by law.
            </p>

            <h2 className={H2}>25. Governing law and disputes</h2>
            <p className="mt-3">
              The governing-law and dispute-resolution provisions for Humanite will depend on the
              jurisdiction of the entity operating the service.
            </p>
            <p className="mt-3">
              This section should be finalized before commercial launch once Humanite’s legal
              entity and governing jurisdiction are established.
            </p>
            <p className="mt-3">
              Nothing in these Terms removes consumer rights or remedies that cannot be waived
              under applicable law.
            </p>

            <h2 className={H2}>26. Contact</h2>
            <p className="mt-3">
              Questions about these Terms may be directed to Humanite through its general support
              channel.
            </p>
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}
