import {
  Avatar,
  AvatarFallback,
  Bubble,
  BubbleContent,
  Marker,
  MarkerContent,
  MarkerIcon,
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Spinner,
} from "NabaReview"
import { Sparkles } from "lucide-react"

type Turn = {
  id: string
  from: "operator" | "assistant"
  time: string
  text: string
}

const TRANSCRIPT: Turn[] = [
  {
    id: "m1",
    from: "operator",
    time: "09:02",
    text: "What is still unanswered at Riverside?",
  },
  {
    id: "m2",
    from: "assistant",
    time: "09:02",
    text: "Six reviews, four of them 2 stars or lower. The oldest is Lena Fischer, five days out.",
  },
  {
    id: "m3",
    from: "operator",
    time: "09:04",
    text: "Draft a reply to Lena. Under 80 words.",
  },
  {
    id: "m4",
    from: "assistant",
    time: "09:05",
    text: "“Thank you for telling us, Lena. A 40-minute check-in is not the arrival we want to give anyone, and I am sorry the courtyard bar kept you awake.”",
  },
  {
    id: "m5",
    from: "operator",
    time: "09:07",
    text: "Warmer, and name the new 22:30 closing time.",
  },
  {
    id: "m6",
    from: "assistant",
    time: "09:08",
    text: "Done — the bar’s 22:30 close is in the second sentence and the sign-off now names the Riverside duty manager.",
  },
  {
    id: "m7",
    from: "operator",
    time: "09:11",
    text: "Good. Post it and move on to Tom Okafor.",
  },
  {
    id: "m8",
    from: "assistant",
    time: "09:11",
    text: "Posted to Google Business Profile. Tom Okafor left 3 stars on Central about the breakfast queue.",
  },
]

function TurnRow({ turn }: { turn: Turn }) {
  const isOperator = turn.from === "operator"
  return (
    <Message align={isOperator ? "end" : "start"}>
      <MessageAvatar>
        <Avatar>
          <AvatarFallback>
            {isOperator ? "DW" : <Sparkles className="size-4" />}
          </AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader className="gap-2">
          {isOperator ? "Dana Whitfield" : "Reply assistant"}
          <span className="font-mono text-muted-foreground">{turn.time}</span>
        </MessageHeader>
        <Bubble variant={isOperator ? "default" : "muted"}>
          <BubbleContent>{turn.text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

export function Transcript() {
  return (
    <div className="h-80 w-full max-w-lg rounded-xl border border-border bg-card p-4">
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-5">
              {TRANSCRIPT.map((turn) => (
                <MessageScrollerItem key={turn.id} messageId={turn.id}>
                  <TurnRow turn={turn} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  )
}

export function JumpToLatest() {
  return (
    <div className="h-96 w-full max-w-lg rounded-xl border border-border bg-card p-4">
      <MessageScrollerProvider defaultScrollPosition="start">
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-5">
              {TRANSCRIPT.map((turn) => (
                <MessageScrollerItem key={turn.id} messageId={turn.id}>
                  <TurnRow turn={turn} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  )
}

export function StreamingDraft() {
  return (
    <div className="h-80 w-full max-w-lg rounded-xl border border-border bg-card p-4">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-5">
              {TRANSCRIPT.slice(0, 3).map((turn) => (
                <MessageScrollerItem key={turn.id} messageId={turn.id}>
                  <TurnRow turn={turn} />
                </MessageScrollerItem>
              ))}
              <MessageScrollerItem messageId="m4-stream" scrollAnchor>
                <div className="flex flex-col gap-2">
                  <TurnRow
                    turn={{
                      id: "m4-stream",
                      from: "assistant",
                      time: "09:05",
                      text: "“Thank you for telling us, Lena. A 40-minute check-in is not the arrival we want to give",
                    }}
                  />
                  <Marker className="px-3">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>Drafting reply &middot; 41 of ~80 words</MarkerContent>
                  </Marker>
                </div>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  )
}
