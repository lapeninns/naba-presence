import {
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "NabaReview"
import {
  Check,
  ChevronDown,
  Clock,
  Ellipsis,
  Search,
  TriangleAlert,
  X,
} from "lucide-react"

export function SearchWithLocation() {
  return (
    <ButtonGroup className="w-full max-w-md">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          defaultValue="breakfast"
          placeholder="Search reviews"
          aria-label="Search reviews"
        />
      </InputGroup>
      <ButtonGroupSeparator />
      <Select defaultValue="central">
        <SelectTrigger aria-label="Location">
          <SelectValue>Central</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="central">Central</SelectItem>
            <SelectItem value="riverside">Riverside</SelectItem>
            <SelectItem value="airport">Airport</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button>Search</Button>
    </ButtonGroup>
  )
}

export function ApproveReject() {
  return (
    <ButtonGroup>
      <Button variant="outline">
        <Check data-icon="inline-start" />
        Approve reply
      </Button>
      <Button variant="outline">
        <X data-icon="inline-start" />
        Reject
      </Button>
      <Button variant="outline" size="icon" aria-label="More actions">
        <Ellipsis />
      </Button>
    </ButtonGroup>
  )
}

export function SplitAction() {
  return (
    <ButtonGroup>
      <Button>Post reply</Button>
      <ButtonGroupSeparator />
      <Button size="icon" aria-label="Reply options">
        <ChevronDown />
      </Button>
    </ButtonGroup>
  )
}

export function WithText() {
  return (
    <ButtonGroup className="w-full max-w-sm">
      <ButtonGroupText>g.page/r/</ButtonGroupText>
      <Input defaultValue="lapen-central" aria-label="Review link slug" />
      <Button variant="outline">Copy</Button>
    </ButtonGroup>
  )
}

export function Vertical() {
  return (
    <ButtonGroup orientation="vertical" className="w-fit">
      <Button variant="outline">
        <Check data-icon="inline-start" />
        Mark handled
      </Button>
      <Button variant="outline">
        <TriangleAlert data-icon="inline-start" />
        Escalate to Central
      </Button>
      <Button variant="outline">
        <Clock data-icon="inline-start" />
        Snooze 7 days
      </Button>
    </ButtonGroup>
  )
}
