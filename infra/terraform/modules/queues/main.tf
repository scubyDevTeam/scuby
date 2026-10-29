variable "name" { type = string }

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-notifications-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "notifications" {
  name                       = "${var.name}-notifications"
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
}

output "queue_url" { value = aws_sqs_queue.notifications.url }
output "queue_arn" { value = aws_sqs_queue.notifications.arn }
output "dlq_arn" { value = aws_sqs_queue.dlq.arn }
