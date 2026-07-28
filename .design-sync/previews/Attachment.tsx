import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
  Spinner,
} from "NabaReview"
import {
  Download,
  FileSpreadsheet,
  ImageIcon,
  Paperclip,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react"

const PHOTOS = [
  { file: "lobby-01.jpg", by: "Priya Sharma" },
  { file: "bar-night.jpg", by: "Lena Fischer" },
  { file: "terrace.jpg", by: "Marco Silva" },
]

export function ExportedReport() {
  return (
    <Attachment>
      <AttachmentMedia>
        <FileSpreadsheet />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>reviews-riverside-may.csv</AttachmentTitle>
        <AttachmentDescription>248 reviews &middot; 84 KB</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label="Download reviews-riverside-may.csv">
          <Download />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}

export function UploadStates() {
  return (
    <AttachmentGroup>
      <Attachment state="done">
        <AttachmentMedia>
          <FileSpreadsheet />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>central-q2.csv</AttachmentTitle>
          <AttachmentDescription>Attached &middot; 312 KB</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label="Remove central-q2.csv">
            <X />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>

      <Attachment state="uploading">
        <AttachmentMedia>
          <Spinner />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>bar-noise.jpg</AttachmentTitle>
          <AttachmentDescription>Uploading &middot; 64%</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label="Cancel upload">
            <X />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>

      <Attachment state="error">
        <AttachmentMedia>
          <TriangleAlert />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>photo-9821.heic</AttachmentTitle>
          <AttachmentDescription>Failed &middot; unsupported format</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label="Retry upload">
            <RefreshCw />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    </AttachmentGroup>
  )
}

export function GuestPhotos() {
  return (
    <AttachmentGroup className="max-w-md">
      {PHOTOS.map((p) => (
        <Attachment key={p.file} orientation="vertical">
          <AttachmentMedia>
            <ImageIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{p.file}</AttachmentTitle>
            <AttachmentDescription>{p.by}</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label={`Remove ${p.file}`}>
              <X />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  )
}

export function Dropzone() {
  return (
    <Attachment state="idle" className="min-w-80">
      <AttachmentMedia>
        <Paperclip />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>Drop a reviews export here</AttachmentTitle>
        <AttachmentDescription>CSV or TSV from Google Business Profile</AttachmentDescription>
      </AttachmentContent>
      <AttachmentTrigger>
        <span className="sr-only">Choose a reviews export to attach</span>
      </AttachmentTrigger>
    </Attachment>
  )
}

export function SizeScale() {
  return (
    <div className="flex flex-col items-start gap-3">
      {(["default", "sm", "xs"] as const).map((size) => (
        <div key={size} className="flex flex-col gap-1">
          <span className="font-mono text-xs text-muted-foreground">{size}</span>
          <Attachment size={size}>
            <AttachmentMedia>
              <FileSpreadsheet />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>reviews-airport-may.csv</AttachmentTitle>
              <AttachmentDescription>96 reviews &middot; 31 KB</AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction aria-label="Remove reviews-airport-may.csv">
                <X />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        </div>
      ))}
    </div>
  )
}
