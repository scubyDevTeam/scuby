variable "name" { type = string }
variable "cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "instance_type" {
  description = "The subnet's AZ is chosen among those that offer this type (not every AZ has t4g)"
  type        = string
  default     = "t4g.small"
}

data "aws_ec2_instance_type_offerings" "available" {
  location_type = "availability-zone"
  filter {
    name   = "instance-type"
    values = [var.instance_type]
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.name }
}

# One public subnet: the instance needs outbound internet (Twilio, Resend, Web Push) and a NAT
# gateway costs ~$32/month (docs/eng/infra.md · Edge).
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.cidr, 8, 1)
  availability_zone       = sort(data.aws_ec2_instance_type_offerings.available.locations)[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

output "vpc_id" { value = aws_vpc.this.id }
# Depends on the route association so nothing boots in the subnet before it can reach the internet.
output "public_subnet_id" {
  value      = aws_subnet.public.id
  depends_on = [aws_route_table_association.public]
}
output "availability_zone" { value = aws_subnet.public.availability_zone }
