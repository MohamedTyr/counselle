import { Avatar, AvatarFallback, AvatarGroup } from "mvp3-frontend"

export function Fallback() {
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>MA</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>JL</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>SR</AvatarFallback>
      </Avatar>
    </div>
  )
}

export function Group() {
  return (
    <AvatarGroup>
      <Avatar><AvatarFallback>MA</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>JL</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>SR</AvatarFallback></Avatar>
      <Avatar><AvatarFallback>+4</AvatarFallback></Avatar>
    </AvatarGroup>
  )
}
