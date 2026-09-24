import type { Metadata } from "next"
import Link from "next/link"

import { LegalDocument, LegalSection } from "@/components/legal/legal-document"
import { LEGAL_OPERATOR } from "@/lib/legal/operator"

export const metadata: Metadata = {
  title: "Privacy policy · NabaPresence",
  description:
    "What NabaPresence collects, why, how long it is kept, and who it is shared with.",
}

// Public and static: no session, no database. See LegalDocument.
export const dynamic = "force-static"

/**
 * Every statement here describes what the code does today. When retention,
 * scopes, processors or deletion behaviour change, change this page in the
 * same pull request.
 */
export default function PrivacyPage() {
  const { legalName, registeredAddress, privacyEmail, databaseHost } =
    LEGAL_OPERATOR
  return (
    <LegalDocument
      title="Privacy policy"
      summary={
        <p>
          NabaPresence helps businesses manage their Google Business Profiles:
          reading and replying to reviews and keeping listing details up to
          date. It is operated by {legalName}, {registeredAddress} (“we”), which
          is the controller of the personal data described here. For review and
          profile data we act on behalf of the business that connected its
          Google account.
        </p>
      }
    >
      <LegalSection id="google-access" title="Google permissions we ask for">
        <p>When you connect a Google account we ask Google for:</p>
        <ul>
          <li>
            <strong>Your basic profile and email address</strong> (
            <code>openid</code>, <code>email</code>, <code>profile</code>), to
            show which Google account is connected.
          </li>
          <li>
            <strong>Management of your Business Profiles</strong> (
            <code>https://www.googleapis.com/auth/business.manage</code>), to
            read reviews, publish the replies you approve, and read and update
            listing details, photos, posts and performance figures for the
            locations you choose.
          </li>
        </ul>
        <p>
          We do not connect a Google account unless Business Profile access is
          granted. We use Google data only to provide these features to the
          business that connected it. We do not sell it, use it for advertising,
          or use it to train AI models. Our use of information received from
          Google APIs follows the{" "}
          <a
            className="underline underline-offset-4"
            href="https://developers.google.com/terms/api-services-user-data-policy"
          >
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <ul>
          <li>
            <strong>Your account:</strong> name, email address, the
            organisations you belong to and your role. Passwords are handled by
            our authentication provider and are never stored in our database.
          </li>
          <li>
            <strong>Sign-in sessions:</strong> a session cookie (
            <code>naba_session</code>) that ends after 14 days without use and
            after 90 days at most, and a
            short-lived cookie (<code>naba_google_oauth</code>, 10 minutes) that
            protects the Google connection step. We use no advertising or
            analytics cookies. Your browser also remembers your theme and any
            unsaved reply drafts locally.
          </li>
          <li>
            <strong>Google connection:</strong> the connected Google account’s
            email address and ID, and the access and refresh tokens Google
            issues. Tokens are encrypted with AES-256-GCM before they are
            stored. We also keep one-way fingerprints of the refresh token, so
            that when Google tells us a token was revoked (its Cross-Account
            Protection service) we can match the notice to the connection
            without keeping another copy of the token.
          </li>
          <li>
            <strong>Business Profile data</strong> for the locations you link:
            reviews (reviewer name, profile photo link, star rating, text and
            dates), review photos, your replies and drafts, listing details,
            photos, posts, opening hours, menus, and performance and search
            keyword figures.
          </li>
          <li>
            <strong>Activity records:</strong> an audit log of actions such as
            connecting Google, approving and publishing replies, and privacy
            requests, including who did them.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="retention" title="How long we keep it">
        <ul>
          <li>
            <strong>Review and listing content from Google</strong> is kept for
            at most 30 days after we last received it from Google (a business
            can choose a shorter period). After that, review text, reviewer
            names, review photos and the raw data Google sent are removed. We
            keep the star rating, dates, the reviewer’s profile photo link and a
            one-way fingerprint of each review, so a review is not imported
            twice and your reports stay accurate. Content under a legal hold is
            kept until the hold ends.
          </li>
          <li>
            <strong>Replies and drafts</strong> that your team wrote are kept
            while the location stays connected, as a record of what was
            published in your name.
          </li>
          <li>
            <strong>Search keyword history</strong> is deleted after 18 months;
            daily performance figures are kept while the location stays
            connected.
          </li>
          <li>
            <strong>Audit records</strong> are kept for one year by default.
          </li>
          <li>
            <strong>Sessions</strong> end after 14 days without use, or 90
            days at most, and are deleted 7 days later.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="disconnect" title="Disconnecting Google and deletion">
        <p>
          You can disconnect a Google account at any time in Settings. When you
          do, we immediately delete the stored access and refresh tokens, stop
          all syncing, and ask Google to revoke our access. If the same Google
          account is still connected in another NabaPresence organisation, we
          do not revoke it, because Google would end that organisation’s access
          too; access ends when the last connection is removed. Seven days later we
          delete the reviews, replies, listing data and figures we imported
          through that account, unless a legal hold applies. We keep a record
          that the account was connected (its email address and ID) and the
          audit log entries about it.
        </p>
        <p>
          You can also remove our access from your Google account at any time at{" "}
          <a
            className="underline underline-offset-4"
            href="https://myaccount.google.com/permissions"
          >
            myaccount.google.com/permissions
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="Who we share it with">
        <p>
          We use these service providers to run NabaPresence, each only for that
          purpose:
        </p>
        <ul>
          <li>
            <strong>Google</strong>, to read and update the Business Profiles
            you connect. Review photos and profile images are loaded by your
            browser directly from Google’s servers.
          </li>
          <li>
            <strong>Vercel</strong>, which hosts the application.
          </li>
          <li>
            <strong>{databaseHost}</strong>, which hosts our database.
          </li>
          <li>
            <strong>Supabase</strong>, which handles sign-in, including account
            confirmation and password reset emails.
          </li>
          <li>
            <strong>Resend</strong>, which delivers our alert emails (for
            example, when Google needs reconnecting or a new low-rated review
            arrives). Alerts go to owners and admins and include the recipient’s
            email address, the location name, a new review’s star rating (never
            its text or the reviewer’s name) and, for a connection alert, the
            connected Google account’s email address.
          </li>
          <li>
            <strong>OpenAI</strong>, when AI reply drafting is switched on: the
            review text, star rating, reviewer’s display name, location name and
            your drafting preferences are sent to generate and check a suggested
            reply. We ask OpenAI not to store these requests.
          </li>
        </ul>
        <p>
          We do not sell personal data. We may disclose it if the law requires
          us to. Our support staff can view your organisation’s workspace to
          help you, and every such session is recorded with a reason.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          Each organisation’s data is isolated in the database, Google tokens
          are encrypted, and all traffic uses HTTPS. No system is perfectly
          secure; if a breach affects your data we will tell you as the law
          requires.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="Your rights and requests">
        <p>
          Depending on where you live, you may have the right to access,
          correct, delete, restrict or object to our use of your personal data,
          and to complain to a data protection authority (in the UK, the
          Information Commissioner’s Office).
        </p>
        <p>
          If you left a review for a business that uses NabaPresence, you can
          ask that business, or us, to remove your details. We can erase your
          name, photo link and review text from our copy and withdraw a reply
          published to your review. Deleting the review itself on Google is done
          through Google.
        </p>
        <p>
          To make a request or ask a question, email {privacyEmail}. We respond
          within one month.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>
          NabaPresence is a business tool and is not intended for anyone under
          18.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this policy">
        <p>
          If we change how we handle personal data we will update this page and
          its effective date, and tell organisation owners about significant
          changes. See also our{" "}
          <Link className="underline underline-offset-4" href="/terms">
            terms of service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
