import {
  Avatar,
  AvatarFallback,
  Bubble,
  BubbleContent,
  Button,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "NabaReview"
import { Check, RefreshCw, Sparkles } from "lucide-react"

function AssistantAvatar() {
  return (
    <MessageAvatar>
      <Avatar>
        <AvatarFallback>
          <Sparkles className="size-4" />
        </AvatarFallback>
      </Avatar>
    </MessageAvatar>
  )
}

function OperatorAvatar() {
  return (
    <MessageAvatar>
      <Avatar>
        <AvatarFallback>DW</AvatarFallback>
      </Avatar>
    </MessageAvatar>
  )
}

export function AssistantTurn() {
  return (
    <div className="w-full max-w-lg">
      <Message>
        <AssistantAvatar />
        <MessageContent>
          <MessageHeader className="gap-2">
            Reply assistant
            <span className="font-mono text-muted-foreground">09:14</span>
          </MessageHeader>
          <Bubble variant="muted">
            <BubbleContent>
              Lena Fischer left 2 stars on Lapen Inn — Riverside. She names a
              40-minute check-in and noise from the courtyard bar. Here is a draft
              that apologises for both without offering compensation.
            </BubbleContent>
          </Bubble>
          <MessageFooter>Drafted from 1 source review</MessageFooter>
        </MessageContent>
      </Message>
    </div>
  )
}

export function OperatorTurn() {
  return (
    <div className="w-full max-w-lg">
      <Message align="end">
        <OperatorAvatar />
        <MessageContent>
          <MessageHeader className="gap-2">
            Dana Whitfield
            <span className="font-mono text-muted-foreground">09:16</span>
          </MessageHeader>
          <Bubble>
            <BubbleContent>
              Warmer, please — and say the courtyard bar now closes at 22:30.
            </BubbleContent>
          </Bubble>
          <MessageFooter className="gap-1">
            <Check className="size-3.5 text-success" />
            Sent
          </MessageFooter>
        </MessageContent>
      </Message>
    </div>
  )
}

export function ConversationGroup() {
  return (
    <div className="w-full max-w-lg">
      <MessageGroup className="gap-6">
        <Message>
          <AssistantAvatar />
          <MessageContent>
            <MessageHeader>Reply assistant</MessageHeader>
            <Bubble variant="muted">
              <BubbleContent>
                Riverside has three unanswered reviews older than 48 hours. Want me
                to start with Lena Fischer&rsquo;s 2-star?
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>

        <Message align="end">
          <OperatorAvatar />
          <MessageContent>
            <MessageHeader>Dana Whitfield</MessageHeader>
            <Bubble>
              <BubbleContent>Yes — keep it under 80 words.</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>

        <Message>
          <AssistantAvatar />
          <MessageContent>
            <MessageHeader>Reply assistant</MessageHeader>
            <Bubble variant="muted">
              <BubbleContent>
                &ldquo;Thank you for telling us, Lena. A 40-minute check-in is not
                the arrival we want to give anyone, and I am sorry the courtyard
                bar kept you awake.&rdquo;
              </BubbleContent>
            </Bubble>
            <MessageFooter>64 words &middot; tone: apologetic</MessageFooter>
          </MessageContent>
        </Message>
      </MessageGroup>
    </div>
  )
}

export function WithActions() {
  return (
    <div className="w-full max-w-lg">
      <Message>
        <AssistantAvatar />
        <MessageContent>
          <MessageHeader className="gap-2">
            Reply assistant
            <span className="font-mono text-muted-foreground">09:21</span>
          </MessageHeader>
          <Bubble variant="muted">
            <BubbleContent>
              &ldquo;Thank you for the kind words, Marco. I have passed them to the
              Airport front desk team — they will be glad the early breakfast was
              worth the 4am start.&rdquo;
            </BubbleContent>
          </Bubble>
          <MessageFooter className="gap-1">
            <Button size="xs">Post reply</Button>
            <Button size="xs" variant="ghost">
              <RefreshCw />
              Redraft
            </Button>
          </MessageFooter>
        </MessageContent>
      </Message>
    </div>
  )
}
