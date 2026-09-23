import type { Metadata } from "next"
import Link from "next/link"

import { LegalDocument, LegalSection } from "@/components/legal/legal-document"
import { LEGAL_OPERATOR } from "@/lib/legal/operator"

export const metadata: Metadata = {
  title: "Terms of service · NabaPresence",
  description:
    "The terms for using NabaPresence to manage Google Business Profiles and reviews.",
}

// Public and static: no session, no database. See LegalDocument.
export const dynamic = "force-static"

export default function TermsPage() {
  const { legalName, registeredAddress, privacyEmail } = LEGAL_OPERATOR
  return (
    <LegalDocument
      title="Terms of service"
      summary={
        <p>
          These terms apply to NabaPresence, a service operated by {legalName} (
          {registeredAddress}) for managing Google Business Profiles: reading
          and replying to reviews and keeping listing details up to date. By
          signing in or connecting a Google account you agree to them on behalf
          of yourself and the business you act for.
        </p>
      }
    >
      <LegalSection id="accounts" title="Your account">
        <p>
          Access is by invitation to an organisation. Keep your sign-in details
          private and tell us promptly if you think someone else has used them.
          Organisation owners decide who else can see and act on their
          locations, and are responsible for the people they invite.
        </p>
      </LegalSection>

      <LegalSection id="google" title="Connecting Google">
        <p>
          To manage a Business Profile you connect a Google account that already
          has access to it. You confirm that you are allowed to manage the
          profiles you connect, and that you will use NabaPresence only in line
          with Google’s own terms and policies for Business Profiles and
          reviews. Your use of Google’s services stays subject to Google’s
          terms.
        </p>
        <p>
          You can disconnect a Google account at any time from Settings. We then
          stop using it straight away and ask Google to revoke our access. Our{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>{" "}
          explains what happens to the data afterwards.
        </p>
      </LegalSection>

      <LegalSection id="content" title="Replies and profile changes">
        <p>
          NabaPresence may suggest replies and changes, including drafts written
          with the help of AI. Nothing is published to Google until a person
          with permission approves it, and you are responsible for what you
          approve and publish under your business’s name. Reviews and other
          content from Google remain the property of their authors and of
          Google.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="Acceptable use">
        <ul>
          <li>
            Do not post fake, misleading or incentivised reviews or replies.
          </li>
          <li>
            Do not use the service to harass reviewers or to publish unlawful
            content.
          </li>
          <li>
            Do not try to reach data belonging to another organisation, or to
            disrupt, probe or overload the service.
          </li>
          <li>Do not resell or share access outside your organisation.</li>
        </ul>
        <p>
          We may suspend access that breaks these rules or puts the service or
          other customers at risk, and will tell you why where we can.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="Availability and changes">
        <p>
          We work to keep NabaPresence available and your data safe, but the
          service depends on Google’s APIs and other providers and is offered as
          it is, without a guarantee that it will be uninterrupted or free of
          errors. We may change or retire features; if a change materially
          affects you we will give reasonable notice.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Liability">
        <p>
          Nothing in these terms limits liability that cannot be limited by law.
          Otherwise, we are not liable for indirect or consequential loss, or
          for loss caused by Google’s services, by content you approve, or by
          events outside our reasonable control.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="Ending use">
        <p>
          You can stop using NabaPresence at any time by disconnecting your
          Google accounts and asking us to close your organisation. We may end
          access with reasonable notice, or immediately for a serious breach of
          these terms.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          We may update these terms. The effective date above shows the current
          version, and we will tell organisation owners about significant
          changes before they apply.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact and governing law">
        <p>
          Questions about these terms: {privacyEmail}. These terms are governed
          by the laws of England and Wales, and its courts have jurisdiction.
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
