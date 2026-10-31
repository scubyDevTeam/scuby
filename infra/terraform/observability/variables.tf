variable "account_id" {
  type    = number
  default = 8675334
}

variable "service_name" {
  type    = string
  default = "scuby-backend"
}

variable "alert_environments" {
  description = "deployment.environment values the alerts watch. Laptop runs (local) never page."
  type        = list(string)
  default     = ["staging", "prod"]
}

variable "alert_email" {
  type    = string
  default = "scubydev@gmail.com"
}

variable "no_data_alert_enabled" {
  description = "Off until a backend runs continuously (staging); otherwise it fires all day."
  type        = bool
  default     = false
}
